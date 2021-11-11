
export async function verifyContract(hre, address, args = undefined, contract = undefined ) {
    const verifyObj = { address } as any
    if(args){
        verifyObj.constructorArguments = args
    }
    if(contract){
        verifyObj.contract = contract;
    }
    return hre.run("verify:verify", verifyObj)
        .then(() =>
            console.log(
                "Contract address verified:",
                address
            )
        ).catch(err => {
            console.log(`Verify Error`, err)
        });
}
