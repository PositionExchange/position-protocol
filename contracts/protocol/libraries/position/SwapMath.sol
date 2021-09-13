pragma solidity ^0.8.0;

library SwapMath {
    function doSwap(
        uint128 liquidity,
        uint256 size,
        uint256 amountRemaining
    )
        internal
        pure
        returns (
            uint256 amountOut
        )
    {
        if(liquidity > amountRemaining){
            amountOut = amountRemaining;
        }else{
            amountOut = liquidity;
        }
    }
}