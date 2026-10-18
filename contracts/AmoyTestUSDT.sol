// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Valueless test token, deployable only on Polygon Amoy.
contract AmoyTestUSDT is ERC20, Ownable2Step {
    mapping(address => bool) public faucetClaimed;
    constructor(address initialOwner) ERC20("UNXO Test USDT", "tUSDT") Ownable(initialOwner) {
        require(block.chainid == 80002, "Amoy testnet only");
        _mint(initialOwner, 1_000_000 * 1e6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
    function faucet() external {
        require(!faucetClaimed[msg.sender], "Already claimed");
        faucetClaimed[msg.sender] = true;
        _mint(msg.sender, 400_000 * 1e6);
    }
    function mint(address recipient, uint256 amount) external onlyOwner { _mint(recipient, amount); }
}
