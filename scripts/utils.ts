import {run} from "hardhat";

export async function verifyContract(address, args, contract ) {
    const verifyObj = { address } as any
    if(args){
        verifyObj.constructorArguments = args
    }
    if(contract){
        verifyObj.contract = contract;
    }
    return run("verify:verify", verifyObj)
        .then(() =>
            console.log(
                "Contract address verified:",
                address
            )
        );
}
