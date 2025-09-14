const dotenv = require("dotenv");
const fs = require("fs");
const {
    clusterApiUrl,
    Connection,
    VersionedTransaction,
    Keypair,
    LAMPORTS_PER_SOL,
    TransactionMessage,
    SystemProgram,
    PublicKey,
} = require("@solana/web3.js");
const BN = require("bn.js");
const bs58 = require('bs58');
const { PumpSdk, BONDING_CURVE_NEW_SIZE } = require('@pump-fun/pump-sdk');

dotenv.config();
const { readFileSync, writeFileSync, existsSync } = require("fs");
const { getTipAccounts, sendBundlesRotating } = require('./bundle');
const { getKeypairFromBase58, getRandomNumber } = require("./utils")


const RPC_URL = process.env.RPC_URL ? process.env.RPC_URL : clusterApiUrl('mainnet-beta');
const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60 * 1000
});
const pumpSDK = new PumpSdk(connection);
const PUMP_GLOBAL = {
    initialized: true,
    authority: new PublicKey("FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF"),
    feeRecipient: new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV"),
    initialVirtualTokenReserves: new BN(1073000000000000),
    initialVirtualSolReserves: new BN(30000000000),
    initialRealTokenReserves: new BN(793100000000000),
    tokenTotalSupply: new BN(1000000000000000),
    feeBasisPoints: new BN(95),
    withdrawAuthority: new PublicKey("39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg"),
    enableMigrate: true,
    poolMigrationFee: new BN(15000001),
    creatorFeeBasisPoints: new BN(5),
    feeRecipients: [
        new PublicKey("7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ"),
        new PublicKey("7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX"),
        new PublicKey("9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz"),
        new PublicKey("AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY"),
        new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"),
        new PublicKey("FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz"),
        new PublicKey("G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP"),
    ],
    setCreatorAuthority: new PublicKey("39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg"),
    adminSetCreatorAuthority: new PublicKey("UqN2p5bAzBqYdHXcgB6WLtuVrdvmy9JSAtgqZb3CMKw")
}


const INSTRUCTION_PER_TX = 3
const MAX_RETRY = 3
const DEV_PERCENT = parseFloat(process.env.MINTER_PERCENT) || 3;
const MIN_PERCENT = parseFloat(process.env.MIN_PERCENT) || 20;
const MAX_PERCENT = parseFloat(process.env.MAX_PERCENT) || 20;
const WALLET_COUNT = parseInt(process.env.WALLET_COUNT) || 15;
const sleep = ms => new Promise(r => setTimeout(r, ms))

// JITO
const JITO_TIP = parseFloat(process.env.JITO_TIP)

// ZOMBIE WALLET (DEPOSIT WALLET to disperse SOL to buyer wallets)
const ZOMBIE = getKeypairFromBase58(process.env.PARENT_ZOMBIE_KEY)
const ZOMBIE_ADDRESS = ZOMBIE.publicKey

// MAIN WALLET
const DevKeypair = getKeypairFromBase58(process.env.MINTER_KEY)
const PAYER_ADDRESS = DevKeypair.publicKey

const gatherSol = async () => {
    let zombieWallets = [];
    if (existsSync('keys.json'))
        zombieWallets = JSON.parse(readFileSync('keys.json', { encoding: 'utf-8' })) || [];
    const transactionPromises = [];
    const maxRetries = 3;

    const sendTransactionWithRetry = async (versionedTransaction, walletIndex, attempt = 0) => {
        try {
            const txId = await connection.sendTransaction(versionedTransaction);
            await connection.confirmTransaction(txId);
            console.log(`Transaction sent and confirmed: ${txId}`);
        } catch (error) {
            if (attempt < maxRetries) {
                console.warn(`Error sending transaction for wallet ${walletIndex}, attempt ${attempt + 1}:`, error);
                await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000)); // Wait before retrying
                return sendTransactionWithRetry(versionedTransaction, walletIndex, attempt + 1);
            } else {
                console.error(`Transaction failed for wallet ${walletIndex} after ${maxRetries} attempts:`, error);
            }
        }
    };

    for (let i = 0; i < zombieWallets.length; i++) {
        const privateKey = zombieWallets[i]['key']
        const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
        const solAmount = await connection.getBalance(keypair.publicKey)
        if (solAmount == 0) continue
        const instructions = SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: ZOMBIE_ADDRESS,
            lamports: solAmount
        })
        const versionedTransaction = new VersionedTransaction(
            new TransactionMessage({
                payerKey: ZOMBIE_ADDRESS,
                recentBlockhash: ((await connection.getLatestBlockhash()).blockhash),
                instructions: [instructions],
            }).compileToV0Message()
        )
        versionedTransaction.sign([ZOMBIE, keypair])
        const transactionPromise = sendTransactionWithRetry(versionedTransaction, i);
        transactionPromises.push(transactionPromise);
    }
    await Promise.all(transactionPromises);

    console.log('Gathering is completed.');
}

async function getTokenAccountBalance(
    walletAddress,
    mintAddress) {
    try {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            walletAddress,
            { mint: mintAddress }
        );

        if (!tokenAccounts)
            return 0;

        // Extract the token amount from the first account (if multiple accounts exist)
        const balance =
            tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount;
        return balance || 0;
    } catch (e) {
        console.log("get token balance error: ", e);
        return -1;
    }
}

async function checkPumpfunAddress(mintAddr) {
    if (mintAddr.toString().slice(-4) != "pump") {
        console.log("💥💥💥 Your TOKEN_PK is not pump.fun PK. Please check it", mintAddr.toString());
        return false;
    }
    const accountExist = await checkTokenAccountExists(mintAddr);
    if (accountExist) {
        console.log("💥💥💥 Your TOKEN_PK is not new pump.fun PK. Please select fresh pump.fun PK");
        return false;
    }
    return true;
}

const checkTokenAccountExists = async (tokenAccountAddress) => {
    try {
        const accountInfo = await connection.getAccountInfo(new PublicKey(tokenAccountAddress));
        return accountInfo !== null;
    } catch (e) {
        console.log("Error checking token account existence: ", e);
        return false;
    }
}

const getSafeTokenBalance = async (
    walletAddr,
    tokenMintAddr
) => {
    let tokenBalance = -1;
    while (1) {
        let checkExsit = await checkTokenAccountExists(tokenMintAddr);
        if (!checkExsit)
            return 0;
        tokenBalance = await getTokenAccountBalance(
            new PublicKey(walletAddr),
            new PublicKey(tokenMintAddr)
        );
        if (tokenBalance !== -1) break;
        await sleep(50);
    }
    return tokenBalance;
}

const checkWallets = async () => {
    const tokenAccount = getKeypairFromBase58(process.env.TOKEN_PK);
    const tokenMint = tokenAccount.publicKey;
    let walletInfo = [];
    walletInfo.push({ wallet: 'ParentZombie', address: ZOMBIE_ADDRESS.toString(), solAmount: await connection.getBalance(ZOMBIE_ADDRESS) / LAMPORTS_PER_SOL, tokenAmount: await getSafeTokenBalance(ZOMBIE_ADDRESS, tokenMint) });
    walletInfo.push({ wallet: 'Dev', address: PAYER_ADDRESS.toString(), solAmount: await connection.getBalance(PAYER_ADDRESS) / LAMPORTS_PER_SOL, tokenAmount: await getSafeTokenBalance(PAYER_ADDRESS, tokenMint) });
    let zombieWallets = [];
    if (existsSync('keys.json'))
        zombieWallets = JSON.parse(readFileSync('keys.json', { encoding: 'utf-8' })) || [];
    for (let i = 0; i < zombieWallets.length; i++) {
        const privateKey = zombieWallets[i]['key']
        const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
        const solAmount = await connection.getBalance(keypair.publicKey)
        walletInfo.push({ wallet: zombieWallets[i]['name'], address: zombieWallets[i]['address'], solAmount: solAmount / LAMPORTS_PER_SOL, tokenAmount: await getSafeTokenBalance(keypair.publicKey, tokenMint) })
    }
    console.table(walletInfo);
}


const calculateTokenAmounts = async (totalAmount, count) => {

    const equalAmount = parseInt(totalAmount / count)

    const tokenAmounts = []
    while (1) {
        let buyAmount = 0;
        for (let i = 0; i < count; i++) {
            const tokenAmount = equalAmount * ((Math.random() * 20 + 90) / 100)
            buyAmount += tokenAmount
            tokenAmounts.push(tokenAmount)
        }
        if (buyAmount <= totalAmount) return tokenAmounts
        else {
            tokenAmounts.length = 0
        }
    }
}

const calculateTokenAmountsMinMax = (totalAmount, count) => {
    const tokenAmounts = [];
    const spaceVal = MAX_PERCENT - MIN_PERCENT;
    for (let i = 0; i < count; i++) {
        const percent = MIN_PERCENT + (Math.random() * spaceVal);
        const tokenAmount = Math.floor(totalAmount * (percent / 100));
        tokenAmounts.push(tokenAmount);
    }
    return tokenAmounts;
}

const getSolAmountsSimulate = async (initSolReserve, initTokenReserve, tokenList) => {
    let tokenReserve = initTokenReserve;
    let solReserve = initSolReserve;

    let solAmounts = [];
    let solAmountIn = 0;

    for (let i = 0; i < tokenList.length; i++) {
        let tokenAmountOut = tokenList[i];

        solAmountIn = getAmountIn(tokenAmountOut, solReserve, tokenReserve);

        // add pump.fun fee 0.95% and 0.3% dev fee + 0.02 extra sol
        const maxSolCost = Math.floor(solAmountIn * (10000 + 125) / 10000 + 0.02 * LAMPORTS_PER_SOL);
        solAmounts.push(maxSolCost);

        tokenReserve -= tokenAmountOut;
        solReserve += solAmountIn;
    }

    return solAmounts;
}

const getAmountIn = (amountOut, reserveIn, reserveOut) => {
    let numerator = (new BN(reserveIn)).mul(new BN(amountOut));
    let denominator = new BN(reserveOut - amountOut);
    let amountIn = numerator.div(denominator);

    return Number(amountIn);
}

const simulateBuyPumpfunTokens = async () => {
    try {
        const virtualInitSolReserve = 30 * LAMPORTS_PER_SOL;
        const virtualInitTokenReserve = 1073000000 * 10 ** 6;

        // DEV WALLET
        const devTokenAmount = parseInt(virtualInitTokenReserve / 100 * DEV_PERCENT);

        // SNIPING WALLET
        const tokenAmountsWithDecimal = [devTokenAmount].concat(calculateTokenAmountsMinMax(virtualInitTokenReserve, WALLET_COUNT))
        const solAmountsInLamports = await getSolAmountsSimulate(
            virtualInitSolReserve,
            virtualInitTokenReserve,
            tokenAmountsWithDecimal
        );

        solAmountsInLamports[0] += 0.02 * LAMPORTS_PER_SOL;

        let totalSol = 0;
        solAmountsInLamports.forEach(amount => {
            totalSol += (amount / LAMPORTS_PER_SOL);
        })
        totalSol += 0.03 // transaction fees

        simulateInfo = [];
        simulateInfo.push({ Wallet: "Dev", TokenAmount: devTokenAmount / 10 ** 6, SolAmount: solAmountsInLamports[0] / LAMPORTS_PER_SOL })
        for (let i = 1; i < tokenAmountsWithDecimal.length; i++) {
            simulateInfo.push({ Wallet: "Zombie" + i, TokenAmount: tokenAmountsWithDecimal[i] / 10 ** 6, SolAmount: solAmountsInLamports[i] / LAMPORTS_PER_SOL })
        }
        console.table(simulateInfo);

        console.log("TotalSol =", totalSol);

        const tokenMint = getKeypairFromBase58(process.env.TOKEN_PK).publicKey.toString();
        console.log("Token Mint Address =", tokenMint);

        return [solAmountsInLamports, tokenAmountsWithDecimal];
    } catch (error) {
        console.log('Error', error)
    }
}

const getBalance = async (walletPublicKey) => {
    if (connection === null || connection === undefined) return -1;

    try {
        const balance = await connection.getBalance(walletPublicKey);
        return balance;
    } catch (err) {
        console.log("get sol balance error: ", err);
        return -1;
    }
}

const getJitoTipInstruction = (keypair) => {
    const tipAccounts = getTipAccounts();
    const tipAccount = new PublicKey(tipAccounts[getRandomNumber(0, tipAccounts.length - 1)]);

    return SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: tipAccount,
        lamports: JITO_TIP * LAMPORTS_PER_SOL,
    })
}

const generatePumpfunKey = async () => {
    console.log("   ⚠️   It could be take a little long time")
    while (1) {
        try {
            const keypair = Keypair.generate()
            if (keypair.publicKey.toBase58().slice(-4) == 'pump') {
                const pk = bs58.encode(keypair.secretKey)
                console.log("🔑 New Pumpfun Key: ", pk);
                return;
            }
        } catch (error) {
            console.log("error", error);
        }
    }

}

const pfMintBuyIxs = async (signerKeypair, tokenMint, tokenName, tokenSymbol, tokenUri, tokenAmountWithDecimal, solAmountInLamports) => {

    const instructions = await pumpSDK.createAndBuyInstructions({
        global: PUMP_GLOBAL,
        mint: tokenMint,
        name: tokenName,
        symbol: tokenSymbol,
        uri: tokenUri,
        creator: signerKeypair.publicKey,
        user: signerKeypair.publicKey,
        amount: new BN(tokenAmountWithDecimal),
        solAmount: new BN(solAmountInLamports),
    })

    return instructions;
}

const pfBuyIxs = async (signerKeypair, devWalletPubkey, tokenMint, tokenAmountWithDecimal, solAmountInLamports, slippage = 1, extendAccount = false) => {

    const bondingCurveAccountInfo = { data: { length: extendAccount ? 0 : BONDING_CURVE_NEW_SIZE } };
    const bondingCurve = { creator: devWalletPubkey };

    return await pumpSDK.buyInstructions({
        global: PUMP_GLOBAL,
        bondingCurveAccountInfo,
        bondingCurve,
        associatedUserAccountInfo: null,
        mint: tokenMint,
        user: signerKeypair.publicKey,
        amount: new BN(tokenAmountWithDecimal),
        solAmount: new BN(solAmountInLamports),
        slippage
    })
}

const pfSellIxs = async (signerKeypair, devWalletPubkey, tokenMint, tokenAmountWithDecimal = 0, slippage = 100, extendAccount = false) => {
    const tokenBalance = await getSafeTokenBalance(
        signerKeypair.publicKey.toBase58(),
        tokenMint.toBase58()
    );

    const tokenAmount2Sell = tokenAmountWithDecimal > 0 ? tokenAmountWithDecimal : tokenBalance * 10 ** 6;

    const bondingCurveAccountInfo = { data: { length: extendAccount ? 0 : BONDING_CURVE_NEW_SIZE } };
    const bondingCurve = { creator: devWalletPubkey };

    return await pumpSDK.sellInstructions({
        global: PUMP_GLOBAL,
        bondingCurveAccountInfo,
        bondingCurve,
        mint: tokenMint,
        user: signerKeypair.publicKey,
        amount: new BN(tokenAmount2Sell),
        solAmount: new BN(0),
        slippage
    })

}


const checkSolBeforeLaunch = async (solAmounts) => {
    let totalSol = 0;
    solAmounts.forEach(amount => {
        totalSol += amount;
    })
    totalSol -= solAmounts[0];
    totalSol += 0.03 * LAMPORTS_PER_SOL; // transaction fees

    const zombieBalance = (await getBalance(ZOMBIE_ADDRESS));
    if (zombieBalance < totalSol) {
        console.log("\n\n💥💥💥 Zombie Wallet balance is insufficient. It has to be at least", totalSol / LAMPORTS_PER_SOL);
        return false;
    }

    const minterBalance = (await getBalance(PAYER_ADDRESS));
    if (minterBalance < solAmounts[0]) {
        console.log("\n\n💥💥💥 Dev Wallet balance is insufficient. It has to be at least", solAmounts[0] / LAMPORTS_PER_SOL);
        return false;
    }

    return true;
}

const buyPumpfunTokens = async () => {

    let zombieWallets = [];
    if (existsSync('keys.json'))
        zombieWallets = JSON.parse(readFileSync('keys.json', { encoding: 'utf-8' })) || [];
    if (zombieWallets.length < WALLET_COUNT) {
        try {
            for (let i = zombieWallets.length; i < WALLET_COUNT; i++) {
                const newKey = Keypair.generate();
                const newPk = bs58.encode(newKey.secretKey);
                const newAddr = newKey.publicKey.toString();
                const index = i + 1;

                zombieWallets.push({
                    "name": "zombie" + index, "address": newAddr, "key": newPk
                })
            }

        } catch (error) {
            console.log(error);
        }

        writeFileSync('keys.json', JSON.stringify(zombieWallets))
    }
    console.table(zombieWallets);
    const tokenAccount = getKeypairFromBase58(process.env.TOKEN_PK);
    const tokenMint = tokenAccount.publicKey;
    console.log('   📢 TokenMintAddress:', tokenMint.toString());
    const checkMintAddr = await checkPumpfunAddress(tokenMint);
    if (!checkMintAddr) {
        console.log("   ❌ Please check your TOKEN_PK in .env file");
        return;
    }
    const [solAmountsInLamports, tokenAmountsWithDecimal] = await simulateBuyPumpfunTokens();

    const checkWallet = checkSolBeforeLaunch(solAmountsInLamports);
    if (!checkWallet) {
        console.log("   ❌ Please charge SOL to your wallets");
        return;
    }

    try {
        const tokenName = process.env.TOKEN_NAME;
        const tokenSymbol = process.env.TOKEN_SYMBOL;
        const tokenImageUrl = process.env.TOKEN_IMAGE_URL;

        const description = process.env.TOKEN_DESCRIPTION;
        const tokenTwitter = process.env.TOKEN_TWITTER;
        const tokenTelegram = process.env.TOKEN_TELEGRAM;
        const tokenWebsite = process.env.TOEKN_WEBSITE;

        let formData = new FormData();
        formData.append("file", await fs.openAsBlob("./img/" + tokenImageUrl)),
            formData.append("name", tokenName),
            formData.append("symbol", tokenSymbol),
            formData.append("description", description),
            formData.append("twitter", tokenTwitter),
            formData.append("telegram", tokenTelegram),
            formData.append("website", tokenWebsite),
            formData.append("showName", "true");

        const metadataResponse = await fetch("https://pump.fun/api/ipfs", {
            method: "POST",
            body: formData,
        });
        const metadataResponseJSON = await metadataResponse.json();
        const tokenUri = metadataResponseJSON.metadataUri;

        console.log('   🎞 MetadataUri:', tokenUri);

        let retry = 0;

        // Lookup Table
        const firstAddressLookup = new PublicKey("Ej3wFtgk3WywPnWPD3aychk38MqTdrjtqXkzbK8FpUih")
        const lookupTableAccount = (await connection.getAddressLookupTable(firstAddressLookup));
        const lookupTableAccounts = [lookupTableAccount.value];

        while (1) {
            try {

                const bundleTxns = []
                const instructions = []

                for (let i = 1; i < solAmountsInLamports.length; i++) {

                    instructions.push(SystemProgram.transfer({
                        fromPubkey: ZOMBIE_ADDRESS,
                        toPubkey: (getKeypairFromBase58(zombieWallets[i - 1]['key'])).publicKey,
                        lamports: parseInt(solAmountsInLamports[i]),
                    }))

                    if (i % INSTRUCTION_PER_TX == 0 || i == solAmountsInLamports.length - 1) {
                        if (i == solAmountsInLamports.length - 1) instructions.push(getJitoTipInstruction(ZOMBIE))
                        const versionedTransaction = new VersionedTransaction(
                            new TransactionMessage({
                                payerKey: ZOMBIE_ADDRESS,
                                recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
                                instructions: instructions,
                            }).compileToV0Message(lookupTableAccounts)
                        )

                        versionedTransaction.sign([ZOMBIE])

                        // console.log("Disperse Sol Txn size", versionedTransaction.serialize().length);

                        bundleTxns.push(versionedTransaction)
                        // let ret = await connection.simulateTransaction(versionedTransaction);
                        instructions.length = 0
                    }
                }

                let ret = await sendBundlesRotating(bundleTxns);
                if (ret) {
                    console.log(`Disperse Sol Success`);
                    break
                }

            } catch (error) {
                console.log('Disperse Sol Error', error)
            }
            await sleep(1000 * (2 ** retry))
            retry++;
            if (retry >= MAX_RETRY) {
                console.log('Disperse Sol Failed')
                process.exit(1)
            }
        }

        balanceInfo = [];
        let tempPublicKey = DevKeypair.publicKey;
        balanceInfo.push({ publicKey: tempPublicKey.toBase58(), balance: await getBalance(tempPublicKey) });
        for (let i = 1; i < solAmountsInLamports.length; i++) {
            tempPublicKey = (getKeypairFromBase58(zombieWallets[i - 1]['key'])).publicKey;
            balanceInfo.push({ publicKey: tempPublicKey.toBase58(), balance: await getBalance(tempPublicKey) });
        }

        console.table(balanceInfo);
        const bundleTxns = []
        let instructions = []

        const mintBuyIxs = await pfMintBuyIxs(
            DevKeypair,
            tokenMint,
            tokenName,
            tokenSymbol,
            tokenUri,
            tokenAmountsWithDecimal[0],
            solAmountsInLamports[0]
        )

        instructions = [...mintBuyIxs];
        let firstSigners = [DevKeypair, tokenAccount]

        for (let i = 1; i < 2; i++) {
            const tokenAmount = tokenAmountsWithDecimal[i]
            const solAmount = solAmountsInLamports[i]
            const payer = getKeypairFromBase58(zombieWallets[i - 1]['key']);
            const txBuy = await pfBuyIxs(
                payer,
                DevKeypair.publicKey,
                tokenMint,
                tokenAmount,
                solAmount
            )
            instructions.push(...txBuy);
            firstSigners.push(payer)
        }

        instructions.push(getJitoTipInstruction(DevKeypair));

        const versionedTransaction = new VersionedTransaction(
            new TransactionMessage({
                payerKey: PAYER_ADDRESS,
                recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
                instructions: instructions,
            }).compileToV0Message(lookupTableAccounts)
        )

        // console.log("first versioned transaction:", versionedTransaction.serialize().length)
        versionedTransaction.sign(firstSigners);
        bundleTxns.push(versionedTransaction);

        instructions.length = 0;
        const signers = [];
        for (let i = 2; i < tokenAmountsWithDecimal.length; i++) {
            const zombieKeypair = getKeypairFromBase58(zombieWallets[i - 1]['key']);

            //Buy Transaction
            const buyIxs = await pfBuyIxs(
                zombieKeypair,
                DevKeypair.publicKey,
                tokenMint,
                tokenAmountsWithDecimal[i],
                solAmountsInLamports[i]
            );

            instructions = [...instructions, ...buyIxs];
            signers.push(zombieKeypair)
            if ((i - 1) % INSTRUCTION_PER_TX == 0 || i == tokenAmountsWithDecimal.length - 1) {
                const versionedTransaction = new VersionedTransaction(
                    new TransactionMessage({
                        payerKey: zombieKeypair.publicKey,
                        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
                        instructions: instructions,
                    }).compileToV0Message(lookupTableAccounts)
                );

                versionedTransaction.sign(signers);
                // console.log("versioned transaction size", versionedTransaction.serialize().length)
                bundleTxns.push(versionedTransaction);
                instructions.length = 0;
                signers.length = 0;
            }
        }


        let ret = await sendBundlesRotating(bundleTxns);
        if (ret) {
            console.log(`Pumpfun Launch Success`);
        } else {
            console.log(`Pumpfun Launch Failed`);
            console.log("reason:", ret)
        }

    } catch (error) {
        console.log('Error', error)
    }
}

const sellAllTokens = async () => {
    try {
        const tokenAccount = getKeypairFromBase58(process.env.TOKEN_PK);
        const tokenMint = tokenAccount.publicKey;

        const tipAddrs = getTipAccounts();
        const tipAccount = new PublicKey(tipAddrs[getRandomNumber(0, tipAddrs.length - 1)]);

        let zombieWallets = [];
        if (existsSync('keys.json'))
            zombieWallets = JSON.parse(readFileSync('keys.json', { encoding: 'utf-8' })) || [];
        zombieWallets.push({ 'name': 'Dev', 'address': PAYER_ADDRESS.toString(), 'key': process.env.MINTER_KEY });


        const pendingBundlePromises = [];
        let transactionCounter = 0;  // Counter to track the number of transactions

        // Direct function to send transaction without retry
        const sendTransaction = async (tx, walletName) => {
            try {
                const ret = await sendBundlesRotating([tx]);
                console.log(`Transaction successful for ${walletName}`);
                return ret;
            } catch (error) {
                console.error(`Transaction failed for ${walletName}:`, error);
                return null;
            }
        };

        for (let i = 0; i < zombieWallets.length; i++) {
            const privateKey = zombieWallets[i]['key'];
            const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
            const tokenBalance = await getSafeTokenBalance(keypair.publicKey, tokenMint);
            const recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;

            if (tokenBalance > 0) {
                let sellIxs = await pfSellIxs(keypair, DevKeypair.publicKey, tokenMint);
                sellIxs.push(
                    SystemProgram.transfer({
                        fromPubkey: keypair.publicKey,
                        toPubkey: tipAccount,
                        lamports: LAMPORTS_PER_SOL * JITO_TIP,
                    })
                );

                console.log("pubkey = ", keypair.publicKey.toBase58());
                const transactionMessage = new TransactionMessage({
                    payerKey: keypair.publicKey,
                    instructions: sellIxs,
                    recentBlockhash,
                });

                const tx = new VersionedTransaction(transactionMessage.compileToV0Message());
                tx.sign([keypair]);

                // Push the sendTransaction promise to the array
                const transactionPromise = sendTransaction(tx, zombieWallets[i]['name']);
                pendingBundlePromises.push(transactionPromise);

                // Increase transaction counter and introduce delay after every 7 transactions
                transactionCounter++;
                if (transactionCounter % 5 === 0) {
                    console.log(`Pausing for 300ms after ${transactionCounter} transactions...`);
                    await new Promise(resolve => setTimeout(resolve, 300));  // Delay for 300ms
                }
            }
        }

        // Execute all transactions concurrently
        const results = await Promise.all(pendingBundlePromises);

        console.log("pendingBundleResponse: ", results);

        if (results.length > 0) {
            let succeed = false;
            for (let k = 0; k < results.length; k++) {
                if (results[k]) {
                    succeed = true;
                    break;
                }
            }
            if (!succeed) {
                console.log("Selling Error");
            }
        }

    } catch (error) {
        console.log("error:", error);
    }
};

const sellTokens = async (addresses) => {
    try {
        const tokenAccount = getKeypairFromBase58(process.env.TOKEN_PK);
        const tokenMint = tokenAccount.publicKey;

        const tipAddrs = getTipAccounts();
        const tipAccount = new PublicKey(tipAddrs[getRandomNumber(0, tipAddrs.length - 1)]);

        let pendingBundlePromises = [];
        let zombieWallets = [];
        zombieWallets.push({ 'name': 'Dev', 'address': PAYER_ADDRESS.toString(), 'key': process.env.MINTER_KEY });
        if (existsSync('keys.json'))
            zombieWallets = [...zombieWallets, ...JSON.parse(readFileSync('keys.json', { encoding: 'utf-8' }))];

        const maxRetries = 5;  // Maximum number of retries
        const retryDelay = 1000; // Delay in milliseconds between retries


        const sendTransactionWithRetry = async (tx, walletName, attempt = 0) => {
            try {
                const ret = await sendBundlesRotating([tx]);
                console.log(`Transaction successful for wallet ${walletName}`);
                return ret;
            } catch (error) {
                if (attempt < maxRetries) {
                    console.warn(`Error sending transaction for ${walletName}, attempt ${attempt + 1}:`, error);
                    await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1))); // Exponential backoff
                    return sendTransactionWithRetry(tx, walletName, attempt + 1); // Retry transaction
                } else {
                    console.error(`Transaction failed for ${walletName} after ${maxRetries} attempts:`, error);
                    return null;
                }
            }
        };

        for (let i = 0; i < addresses.length; i++) {
            const wallet = zombieWallets.find(wallet => wallet.address === addresses[i]);
            if (!wallet) {
                console.log("💥💥💥", addresses[i], "is not exist. Please check it");
                return;
            }
            const privateKey = wallet['key'];
            const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
            const tokenBalance = await getSafeTokenBalance(keypair.publicKey, tokenMint);

            if (tokenBalance > 0) {

                let sellIxs = await pfSellIxs(keypair, DevKeypair.publicKey, tokenMint);
                const recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;

                sellIxs.push(
                    SystemProgram.transfer({
                        fromPubkey: keypair.publicKey,
                        toPubkey: tipAccount,
                        lamports: LAMPORTS_PER_SOL * JITO_TIP,
                    })
                )
                const transactionMessage = new TransactionMessage({
                    payerKey: keypair.publicKey,
                    instructions: sellIxs,
                    recentBlockhash,
                });
                const tx = new VersionedTransaction(transactionMessage.compileToV0Message());
                tx.sign([keypair]);
                // const ret = await sendTransactionWithRetry(tx, numbers[i]);
                const transactionPromise = sendTransactionWithRetry(tx, wallet['name']);
                pendingBundlePromises.push(transactionPromise);
            }
        }
        const results = await Promise.all(pendingBundlePromises);
        console.log("pendingBundleResponse: ", results);
        if (results.length > 0) {
            let succeed = false;
            for (let k = 0; k < results.length; k++) {
                if (results[k]) {
                    succeed = true;
                    break;
                }
            }
            if (!succeed) {
                console.log("Selling Error");
            }
        }

    } catch (error) {
        console.log("error:", error);
    }

}

module.exports = {
    buyPumpfunTokens,
    generatePumpfunKey,
    simulateBuyPumpfunTokens,
    gatherSol,
    checkWallets,
    sellAllTokens,
    sellTokens,
}