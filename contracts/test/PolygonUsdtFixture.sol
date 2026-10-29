// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {TestPaymentToken} from "./TestPaymentToken.sol";

/// @dev Local chain-137 tests only; production uses the existing canonical token.
contract PolygonUsdtFixture is TestPaymentToken {
    constructor() TestPaymentToken(6) {}
    function symbol() public pure override returns (string memory) { return "USDT0"; }
}
