// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./LimitOrder.sol";
//import "hardhat/console.sol";

/*
 * A library storing data and logic at a pip
 */
library TickPosition {
    using SafeMath for uint128;
    using SafeMath for uint64;
    using LimitOrder for LimitOrder.Data;
    struct Data {
        uint128 liquidity;
        uint64 filledIndex;
        uint64 currentIndex;
        // position at a certain tick
        // index => order data
        mapping(uint64 => LimitOrder.Data) orderQueue;
    }

    function insertLimitOrder(
        TickPosition.Data storage _self,
        uint128 _size,
        bool _hasLiquidity,
        bool _isBuy
    ) internal returns (uint64) {
        _self.currentIndex++;
        if (
            !_hasLiquidity &&
            _self.filledIndex != _self.currentIndex &&
            _self.liquidity != 0
        ) {
            // means it has liquidity but is not set currentIndex yet
            // reset the filledIndex to fill all
            _self.filledIndex = _self.currentIndex;
            _self.liquidity = _size;
        } else {
            _self.liquidity = _self.liquidity + _size;
        }
        _self.orderQueue[_self.currentIndex].update(_isBuy, _size);
        return _self.currentIndex;
    }

    function updateOrderWhenClose(
        TickPosition.Data storage _self,
        uint64 _orderId
    ) internal returns (uint256) {
        return _self.orderQueue[_orderId].updateWhenClose();
    }

    function getQueueOrder(TickPosition.Data storage _self, uint64 _orderId)
        internal
        view
        returns (
            bool isFilled,
            bool isBuy,
            uint256 size,
            uint256 partialFilled
        )
    {
        (isBuy, size, partialFilled) = _self.orderQueue[_orderId].getData();
        if (_self.filledIndex > _orderId && size != 0) {
            isFilled = true;
        } else if (_self.filledIndex < _orderId) {
            isFilled = false;
        } else {
            isFilled = partialFilled >= size && size != 0 ? true : false;
        }
    }

    function partiallyFill(TickPosition.Data storage _self, uint128 _amount)
        internal
    {
        _self.liquidity -= _amount;
        unchecked {
            uint64 index = _self.filledIndex;
            uint128 totalSize = 0;
            if (
                _self.orderQueue[index].size ==
                _self.orderQueue[index].partialFilled
            ) {
                index++;
            }
            if (_self.orderQueue[index].partialFilled != 0) {
                totalSize += (_self.orderQueue[index].size - _self.orderQueue[index].partialFilled);
                index++;
            }
            while (totalSize < _amount) {
                totalSize += _self.orderQueue[index].size;
                index++;
            }
            index--;
            _self.filledIndex = index;
            _self.orderQueue[index].updatePartialFill(
                uint120(totalSize - _amount)
            );
        }
    }

    function cancelLimitOrder(TickPosition.Data storage _self, uint64 _orderId)
        internal
        returns (uint256, uint256, bool)
    {
        (bool isBuy, uint256 size, uint256 partialFilled) = _self
            .orderQueue[_orderId]
            .getData();
        if (_self.liquidity >= uint128(size - partialFilled)) {
            _self.liquidity = _self.liquidity - uint128(size - partialFilled);
        }
        _self.orderQueue[_orderId].update(isBuy, partialFilled);
        return (size - partialFilled, partialFilled, isBuy);
    }

    function closeLimitOrder(
        TickPosition.Data storage _self,
        uint64 _orderId,
        uint256 _amountClose
    ) internal returns (uint256 remainAmountClose) {
        (bool isBuy, uint256 size, uint256 partialFilled) = _self
            .orderQueue[_orderId]
            .getData();

        uint256 amount = _amountClose > partialFilled ? 0 : _amountClose;
        if (_amountClose > partialFilled) {
            uint256 amount = size - partialFilled;
            _self.orderQueue[_orderId].update(isBuy, amount);
            remainAmountClose = _amountClose - partialFilled;
        } else {
            uint256 amount = partialFilled - _amountClose;
            _self.orderQueue[_orderId].update(isBuy, amount);
            remainAmountClose = 0;
        }
    }
}
