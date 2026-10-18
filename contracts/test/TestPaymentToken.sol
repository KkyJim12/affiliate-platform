// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Local tests and explicitly requested Amoy mock deployments only.
contract TestPaymentToken is ERC20 {
    uint8 private immutable precision;
    address public blockedRecipient;
    bool public chargeFee;
    bool public zeroFirst;

    constructor(uint8 decimals_) ERC20("Test USDT", "tUSDT") { precision = decimals_; }
    function decimals() public view override returns (uint8) { return precision; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setBlocked(address recipient) external { blockedRecipient = recipient; }
    function setChargeFee(bool value) external { chargeFee = value; }
    function setZeroFirst(bool value) external { zeroFirst = value; }
    function approve(address spender, uint256 amount) public override returns (bool) {
        require(!zeroFirst || amount == 0 || allowance(msg.sender, spender) == 0, "zero first");
        return super.approve(spender, amount);
    }
    function _update(address from, address to, uint256 amount) internal override {
        require(to != blockedRecipient || to == address(0), "blocked recipient");
        if (chargeFee && from != address(0) && to != address(0) && amount > 100) {
            super._update(from, address(0), 1);
            super._update(from, to, amount - 1);
        } else super._update(from, to, amount);
    }
}
