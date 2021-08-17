// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {Calc} from "../math/Calc.sol";
//import { Decimal } from "./Decimal.sol";

abstract contract Uint256ERC20 {
    using SafeMath for uint256;

    mapping(address => uint256) private decimalMap;

    //◥◤◥◤◥◤◥◤◥◤◥◤◥◤◥◤ add state variables below ◥◤◥◤◥◤◥◤◥◤◥◤◥◤◥◤//

    //◢◣◢◣◢◣◢◣◢◣◢◣◢◣◢◣ add state variables above ◢◣◢◣◢◣◢◣◢◣◢◣◢◣◢◣//
    uint256[50] private __gap;

    //
    // INTERNAL functions
    //

    // CAUTION: do not input _from == _to s.t. this function will always fail
    function _transfer(
        IERC20 _token,
        address _to,
        uint256 _value
    ) internal {
        _updateDecimal(address(_token));
        uint256 balanceBefore = _balanceOf(_token, _to);
        uint256 roundedDownValue = _toUint(_token, _value);

        // solhint-disable avoid-low-level-calls
        (bool success, bytes memory data) =
        address(_token).call(abi.encodeWithSelector(_token.transfer.selector, _to, roundedDownValue));

        require(success && (data.length == 0 || abi.decode(data, (bool))), "DecimalERC20: transfer failed");
        _validateBalance(_token, _to, roundedDownValue, balanceBefore);
    }

    function _transferFrom(
        IERC20 _token,
        address _from,
        address _to,
        uint256 _value
    ) internal {
        _updateDecimal(address(_token));
        uint256 balanceBefore = _balanceOf(_token, _to);
        uint256 roundedDownValue = _toUint(_token, _value);

        // solhint-disable avoid-low-level-calls
        (bool success, bytes memory  data) =
        address(_token).call(abi.encodeWithSelector(_token.transferFrom.selector, _from, _to, roundedDownValue));

        require(success && (data.length == 0 || abi.decode(data, (bool))), "DecimalERC20: transferFrom failed");
        _validateBalance(_token, _to, roundedDownValue, balanceBefore);
    }

    function _approve(
        IERC20 _token,
        address _spender,
        uint256 _value
    ) internal {
        _updateDecimal(address(_token));
        // to be compatible with some erc20 tokens like USDT
        __approve(_token, _spender, 0);
        __approve(_token, _spender, _value);
    }

    //
    // VIEW
    //
    function _allowance(
        IERC20 _token,
        address _owner,
        address _spender
    ) internal view returns (uint256) {
        return _toDecimal(_token, _token.allowance(_owner, _spender));
    }

    function _balanceOf(IERC20 _token, address _owner) internal view returns (uint256) {
        return _toDecimal(_token, _token.balanceOf(_owner));
    }

    function _totalSupply(IERC20 _token) internal view returns (uint256) {
        return _toDecimal(_token, _token.totalSupply());
    }

    function _toDecimal(IERC20 _token, uint256 _number) internal view returns (uint256) {
        uint256 tokenDecimals = _getTokenDecimals(address(_token));
        if (tokenDecimals >= 18) {
            return _number.div(10 ** (tokenDecimals.sub(18)));
        }

        return _number.mul(10 ** (uint256(18).sub(tokenDecimals)));
    }

    function _toUint(IERC20 _token, uint256 _decimal) internal view returns (uint256) {
        uint256 tokenDecimals = _getTokenDecimals(address(_token));
        if (tokenDecimals >= 18) {
            return _decimal.mul(10 ** (tokenDecimals.sub(18)));
        }
        return _decimal.div(10 ** (uint256(18).sub(tokenDecimals)));
    }

    function _getTokenDecimals(address _token) internal view returns (uint256) {
        uint256 tokenDecimals = decimalMap[_token];
        if (tokenDecimals == 0) {
            (bool success, bytes memory  data) = _token.staticcall(abi.encodeWithSignature("decimals()"));
            require(success && data.length != 0, "DecimalERC20: get decimals failed");
            tokenDecimals = abi.decode(data, (uint256));
        }
        return tokenDecimals;
    }

    //
    // PRIVATE
    //
    function _updateDecimal(address _token) private {
        uint256 tokenDecimals = _getTokenDecimals(_token);
        if (decimalMap[_token] != tokenDecimals) {
            decimalMap[_token] = tokenDecimals;
        }
    }

    function __approve(
        IERC20 _token,
        address _spender,
        uint256 _value
    ) private {
        // solhint-disable avoid-low-level-calls
        (bool success, bytes memory  data) =
        address(_token).call(abi.encodeWithSelector(_token.approve.selector, _spender, _toUint(_token, _value)));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "DecimalERC20: approve failed");
    }

    // To prevent from deflationary token, check receiver's balance is as expectation.
    function _validateBalance(
        IERC20 _token,
        address _to,
        uint256 _roundedDownValue,
        uint256 _balanceBefore
    ) private view {
        require(
            Calc.cmp(_balanceOf(_token, _to), _balanceBefore.add(_toDecimal(_token, _roundedDownValue))) == 0,
            "DecimalERC20: balance inconsistent"
        );
    }
}
