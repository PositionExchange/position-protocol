// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract PositionNotionalConfigProxy is Initializable {
    bytes32 constant BTC_BUSD = "BTC_BUSD";
    bytes32 constant BNB_BUSD = "BNB_BUSD";

    function getMaxNotional(bytes32 key, uint16 leverage) external returns (uint256){
        if(key == BTC_BUSD) { //BTC_BUSD hash
            if(leverage == 1) {
                return 1_000_000_000_000;
            }else if(leverage == 2){
                return 600_000_000;
            }else if(leverage == 3){
                return 400_000_000;
            }else if(leverage == 4){
                return 200_000_000;
            }else if(leverage >= 5 && leverage <= 10){
                return 100_000_000;
            }else if(leverage > 10 && leverage <= 20){
                return 40_000_000;
            }else if(leverage > 20 && leverage <= 50){
                return 7_500_000;
            }else if(leverage > 50 && leverage <= 100){
                return 1_000_000;
            }else if(leverage > 100 && leverage <= 124){
                return 250_000;
            }
            return 50_000;
        } else if (key == BNB_BUSD) { //BNB_BUSD hash
            if(leverage == 1) {
                return 30_000_000;
            }else if(leverage == 2){
                return 5_000_000;
            }else if(leverage == 3){
                return 2_000_000;
            }else if(leverage == 4){
                return 1_000_000;
            }else if(leverage >= 5 && leverage <= 10){
                return 500_000;
            }else if(leverage > 10 && leverage <= 20){
                return 100_000;
            }else if(leverage > 20 && leverage <= 50){
                return 50_000;
            }else if(leverage > 50 && leverage <= 100){
                return 10_000;
            }
        }
//        return 50_000;
        // only for qc test
        return 1_000_000_000_000_000_000_000;
    }
}