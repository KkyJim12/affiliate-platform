// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Fixed-price referral purchases with immediate ERC-20 distribution.
/// @dev The authority attests placement, eligibility, legacy paid levels and
/// completed cycles. Automatic quotes can spend the member's approved tokens;
/// manual purchases require the buyer. Prices/rates are fixed and quotes cannot replay.
contract ReferralDistributor is Ownable2Step, EIP712, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint8 public constant MAX_LEVEL = 15;
    uint256 public constant distributionVersion = 3;
    bytes32 public constant PURCHASE_TYPEHASH = keccak256(
        "Purchase(bytes32 id,address buyer,uint8 level,uint8 previousLevel,bytes32 uplinesHash,address feeRecipient,uint256 configNonce,uint256 deadline,bytes32 matrixCycle)"
    );
    IERC20 public immutable paymentToken;
    uint8 public immutable tokenDecimals;
    uint256 public immutable ledgerMultiplier;
    address public feeRecipient;
    address public quoteSigner;
    uint256 public configNonce;
    mapping(address => uint8) public levelOf;
    mapping(bytes32 => bool) public purchased;
    mapping(bytes32 => bool) public upgradedCycles;

    struct Purchase {
        bytes32 id;
        address buyer;
        uint8 level;
        uint8 previousLevel;
        bytes32 uplinesHash;
        address feeRecipient;
        uint256 configNonce;
        uint256 deadline;
        bytes32 matrixCycle;
    }

    error InvalidAddress();
    error UnsupportedDecimals();
    error InvalidPurchase();
    error InvalidLevel();
    error StaleQuote();
    error InvalidSignature();
    error InvalidUplines();
    error UnsupportedToken();

    event FeeRecipientChanged(address indexed previousRecipient, address indexed recipient, uint256 configNonce);
    event QuoteSignerChanged(address indexed signer, uint256 configNonce);
    // kind: 0 = direct, 1 = 1%-per-level bonus, 2 = platform fee.
    event SharePaid(bytes32 indexed id, uint8 kind, uint8 depth, address indexed recipient, uint256 amount, bool redirected);
    event PurchaseCompleted(bytes32 indexed id, address indexed buyer, uint8 level, uint8 previousLevel,
        uint256 amount, address feeRecipient, bytes32 uplinesHash, uint256 configNonce);

    constructor(address token, address initialOwner, address initialFeeRecipient, address initialQuoteSigner)
        Ownable(initialOwner) EIP712("UNXO Referral Distributor", "1")
    {
        if (token.code.length == 0 || initialFeeRecipient == address(0) || initialFeeRecipient == address(this)
            || initialQuoteSigner == address(0)) revert InvalidAddress();
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals < 6 || decimals > 18) revert UnsupportedDecimals();
        paymentToken = IERC20(token);
        tokenDecimals = decimals;
        ledgerMultiplier = 10 ** (decimals - 6);
        feeRecipient = initialFeeRecipient;
        quoteSigner = initialQuoteSigner;
    }

    function priceForLevel(uint8 level) public view returns (uint256) {
        if (level == 0 || level > MAX_LEVEL) revert InvalidLevel();
        return (uint256(10_000_000) << (level - 1)) * ledgerMultiplier;
    }

    /// @return amounts First 3 direct shares, 15 bonuses, then the platform fee.
    /// Rounding is in micro-USDT, including when the token has 18 decimals.
    function previewShares(uint8 level) public view returns (uint256[19] memory amounts) {
        uint256 microPrice = priceForLevel(level) / ledgerMultiplier;
        amounts[0] = microPrice / 10;
        amounts[1] = microPrice / 5;
        amounts[2] = microPrice / 2;
        amounts[18] = microPrice / 20;
        for (uint256 i; i < 15; ++i) amounts[i + 3] = microPrice / 100;
        for (uint256 i; i < 19; ++i) amounts[i] *= ledgerMultiplier;
    }

    function purchase(Purchase calldata quote, address[18] calldata uplines, bytes calldata signature)
        external nonReentrant whenNotPaused
    {
        if (quote.buyer != msg.sender || quote.matrixCycle != bytes32(0)) revert InvalidPurchase();
        _purchase(quote, uplines, signature);
    }

    /// @dev The quote authority attests a completed matrix or unilevel tree.
    /// The legacy matrixCycle field binds either program's completion ID.
    /// The member must have
    /// approved enough tokens in advance; no wallet key or signature is held here.
    function autoUpgrade(Purchase calldata quote, address[18] calldata uplines, bytes calldata signature)
        external nonReentrant whenNotPaused
    {
        if (quote.matrixCycle == bytes32(0) || upgradedCycles[quote.matrixCycle] || quote.previousLevel == 0)
            revert InvalidPurchase();
        upgradedCycles[quote.matrixCycle] = true;
        _purchase(quote, uplines, signature);
    }

    function _purchase(Purchase calldata quote, address[18] calldata uplines, bytes calldata signature) private {
        if (quote.buyer == address(0) || quote.id == bytes32(0) || purchased[quote.id]) revert InvalidPurchase();
        if (quote.level == 0 || quote.level > MAX_LEVEL || quote.level != quote.previousLevel + 1)
            revert InvalidLevel();
        uint8 previous = levelOf[quote.buyer];
        // A signed previousLevel bootstraps existing paid members exactly once.
        if (previous != 0 && previous != quote.previousLevel) revert InvalidLevel();
        if (block.timestamp > quote.deadline || quote.feeRecipient != feeRecipient || quote.configNonce != configNonce)
            revert StaleQuote();
        if (quote.uplinesHash != keccak256(abi.encode(uplines))) revert InvalidUplines();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(PURCHASE_TYPEHASH, quote.id, quote.buyer,
            quote.level, quote.previousLevel, quote.uplinesHash, quote.feeRecipient, quote.configNonce, quote.deadline, quote.matrixCycle)));
        if (ECDSA.recover(digest, signature) != quoteSigner) revert InvalidSignature();
        for (uint256 i; i < 18; ++i) {
            if (uplines[i] == address(0)) continue;
            if (uplines[i] == quote.buyer || uplines[i] == address(this)) revert InvalidUplines();
            // An owner can appear in both trees, but only once within each tree.
            for (uint256 j = i < 3 ? 0 : 3; j < i; ++j)
                if (uplines[j] == uplines[i]) revert InvalidUplines();
        }
        purchased[quote.id] = true;
        levelOf[quote.buyer] = quote.level;
        uint256 price = priceForLevel(quote.level);
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(quote.buyer, address(this), price);
        if (paymentToken.balanceOf(address(this)) != beforeBalance + price) revert UnsupportedToken();
        uint256[19] memory amounts = previewShares(quote.level);
        for (uint8 i; i < 3; ++i) _pay(quote.id, 0, i + 1, uplines[i], amounts[i], false);
        for (uint8 i; i < 15; ++i) {
            _pay(quote.id, 1, i + 1, uplines[i + 3], amounts[i + 3], false);
        }
        _pay(quote.id, 2, 0, feeRecipient, amounts[18], false);
        if (paymentToken.balanceOf(address(this)) != beforeBalance) revert UnsupportedToken();
        emit PurchaseCompleted(quote.id, quote.buyer, quote.level, quote.previousLevel, price,
            feeRecipient, quote.uplinesHash, quote.configNonce);
    }

    function _pay(bytes32 id, uint8 kind, uint8 depth, address recipient, uint256 amount, bool redirected) private {
        if (recipient == address(0)) { recipient = feeRecipient; redirected = true; }
        uint256 beforeBalance = paymentToken.balanceOf(recipient);
        paymentToken.safeTransfer(recipient, amount);
        if (paymentToken.balanceOf(recipient) != beforeBalance + amount) revert UnsupportedToken();
        emit SharePaid(id, kind, depth, recipient, amount, redirected);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0) || recipient == address(this)) revert InvalidAddress();
        address previous = feeRecipient;
        feeRecipient = recipient;
        emit FeeRecipientChanged(previous, recipient, ++configNonce);
    }

    function setQuoteSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert InvalidAddress();
        quoteSigner = signer;
        emit QuoteSignerChanged(signer, ++configNonce);
    }

    function setPaused(bool value) external onlyOwner {
        if (value) _pause(); else _unpause();
    }
}
