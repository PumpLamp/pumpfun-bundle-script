const axios = require("axios");
const { Base64 } = require('js-base64');
const dotenv = require("dotenv");
dotenv.config();
const JITO_TIMEOUT = 15000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));


const locales = [
    "Mainnet",
    "Frankfurt",
    "Amsterdam",
    "London",
    "NewYork",
    "Tokyo",
    "SaltLakeCity",
    "Singapore",
];


const endPoints = [
    "mainnet.block-engine.jito.wtf",
    "frankfurt.mainnet.block-engine.jito.wtf",
    "amsterdam.mainnet.block-engine.jito.wtf",
    "london.mainnet.block-engine.jito.wtf",
    "ny.mainnet.block-engine.jito.wtf",
    "tokyo.mainnet.block-engine.jito.wtf",
    "slc.mainnet.block-engine.jito.wtf",
    "singapore.mainnet.block-engine.jito.wtf",
];


exports.getTipAccounts = () => {
    const tipAddrs = [
        'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
        'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
        '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
        '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
        'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
        'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
        'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
        'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe'
    ]
    return tipAddrs;
}


exports.sendBundles = async (transactions) => {
    try {
        if (transactions.length === 0)
            return;

        // console.log("Sending bundles...");

        const rawTransactions = transactions.map((item) => Base64.encode(item.serialize()));

        // const { data: simData } = await axios.post(`${process.env.RPC_URL}`,
        //     {
        //         jsonrpc: "2.0",
        //         id: 1,
        //         method: "simulateBundle",
        //         params: [
        //             { "encodedTransactions": rawTransactions }
        //         ],
        //     },
        //     {
        //         headers: {
        //             "Content-Type": "application/json",
        //         },
        //     }
        // );
        // console.log(`[JITO] Simulated Bundle:`, simData.result?.value?.summary?.failed?.error ?? simData.result?.value);
        // return false;

        const { data } = await axios.post(`https://${process.env.JITO_MAINNET_URL}/api/v1/bundles`,
            {
                jsonrpc: "2.0",
                id: 1,
                method: "sendBundle",
                params: [
                    rawTransactions,
                    {
                        "encoding": "base64"
                    }
                ],
            },
            {
                headers: {
                    "Content-Type": "application/json",
                }
            }
        );
        const uuid = data.result

        console.log("Checking bundle's status...", uuid);
        const sentTime = Date.now();
        while (Date.now() - sentTime < JITO_TIMEOUT) {
            try {
                const { data } = await axios.post(`https://${process.env.JITO_MAINNET_URL}/api/v1/bundles`,
                    {
                        jsonrpc: "2.0",
                        id: 1,
                        method: "getBundleStatuses",
                        params: [
                            [uuid]
                        ],
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                        }
                    }
                );

                if (data) {
                    const bundleStatuses = data.result.value;
                    // console.log("Bundle Statuses:", bundleStatuses);
                    let success = true;

                    const matched = bundleStatuses.find(bStatus => bStatus && bStatus.bundle_id === uuid);
                    if (!matched || matched.confirmation_status !== "finalized") {
                        success = false;
                    }
                    if (success) {
                        // console.log('Bundle', uuid, 'Success')
                        return true;
                    }
                }
            }
            catch (err) {
                console.log("JITO ERROR:", err);
            }

            await sleep(1000);
        }
    }
    catch (err) {
        console.log("Send Bundle Error", err);
    }
    return false;
}


const sendBundlesWithLocale = async (locale = 3, bundles, skipBundleResultCheck = false, isBase64 = true) => {
    try {

        if (bundles.length === 0)
            return false;

        console.log(`[JITO ${locales[locale]}] Sending`, bundles.length, "bundles...");

        let bundleIds = [];
        for (let i = 0; i < bundles.length; i++) {
            const rawTransactions = bundles[i].map((item) => isBase64 ? Base64.encode(item.serialize()) : bs58.encode(item.serialize()));

            // const { data: simData } = await axios.post(`${process.env.RPC_URL}`,
            //     {
            //         jsonrpc: "2.0",
            //         id: 1,
            //         method: "simulateBundle",
            //         params: [
            //             { "encodedTransactions": rawTransactions }
            //         ],
            //     },
            //     {
            //         headers: {
            //             "Content-Type": "application/json",
            //         },
            //     }
            // );
            // console.log(`[JITO ${locales[locale]}] Simulated Bundle:`, simData.result?.value?.summary?.failed?.error ?? simData.result?.value ?? simData);
            // return false;

            const { data } = await axios.post(`https://${endPoints[locale]}/api/v1/bundles?uuid=${process.env.AUTH_UUID}`,
                {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "sendBundle",
                    params: [
                        rawTransactions,
                        {
                            "encoding": isBase64 ? "base64" : "base58"
                        }
                    ],
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "x-jito-auth": process.env.AUTH_UUID,
                    },
                }
            );
            if (data) {
                // console.log(data);
                bundleIds = [
                    ...bundleIds,
                    data.result,
                ];
            }
        }

        if (skipBundleResultCheck) {
            console.log(`[JITO ${locales[locale]}] skip result check...`, bundleIds);
            return true
        }

        // console.log(`[JITO ${locales[locale]}] Checking bundles...`, bundleIds);
        const sentTime = Date.now();
        while (Date.now() - sentTime < JITO_TIMEOUT) {
            try {
                const { data } = await axios.post(`https://${endPoints[locale]}/api/v1/getBundleStatuses`,
                    {
                        jsonrpc: "2.0",
                        id: 1,
                        method: "getBundleStatuses",
                        params: [
                            bundleIds
                        ],
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                        },
                    }
                );

                if (data) {
                    const bundleStatuses = data.result.value;
                    // console.log(`[JITO ${locales[locale]}] Bundle Statuses:`, bundleStatuses);
                    let success = true;
                    for (let i = 0; i < bundleIds.length; i++) {
                        const matched = bundleStatuses.find((item) => item && item.bundle_id === bundleIds[i]);
                        if (!matched || matched.confirmation_status !== "confirmed") {    // "finalized"
                            success = false;
                            break;
                        }
                    }

                    if (success) {
                        console.log(`[JITO ${locales[locale]}] ✔️  Bundle Success...`, bundleIds);
                        return true;
                    }
                }
            }
            catch (err) {
                console.log(`[JITO ${locales[locale]}] ❌ ERROR:`, err.response?.status, err.response?.statusText, err.response?.data?.error ?? err.response?.headers);
            }

            await sleep(1000);
        }
    }
    catch (err) {
        console.log(`[JITO ${locales[locale]}] ❌ Bundle Failed...`, err.response?.status, err.response?.statusText, err.response?.data?.error ?? err.response?.headers ?? err);
        return false;
    }
    console.log(`[JITO ${locales[locale]}] ❌ Bundle Failed...`);
    return false;
}

let pos = 0;
exports.sendBundlesRotating = async (bundle, skipBundleResultCheck = false, isBase64 = true) => {
    pos = ++pos % locales.length;
    const ret = await sendBundlesWithLocale(pos, [bundle], skipBundleResultCheck, isBase64);
    return ret;
}