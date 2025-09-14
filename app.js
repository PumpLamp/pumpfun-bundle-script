const { Command } = require('program-commander');
const chalk = require("chalk").default;
const figlet = require('figlet');
const { simulateBuyPumpfunTokens, buyPumpfunTokens, generatePumpfunKey, gatherSol, checkWallets, sellAllTokens, sellTokens } = require('./src/bot');
async function main() {
    const program = new Command();

    const fig_text = figlet.textSync("Pump.fun Bundle Script", {
        font: "ANSI Shadow",
        horizontalLayout: "default",
        verticalLayout: "default",
        width: 150,
        whitespaceBreak: true,
    });

    console.log("\n\n");
    console.log(chalk.cyanBright.bold(fig_text));
    console.log(chalk.yellowBright.bold("Version: 1.0.0"));

    program
        .helpOption("-h, --help", "display help")
        .description("This script is a bot for sniping tokens when launching your token on Pump.Fun")
        .option("--simulate", "Simulate bundle process and estimate SOL amount for zombie wallets")
        .option("--launch", "Mint and snipe tokens on Pump.Fun")
        .option("--gen-ca", "Generate New Pump.fun Token CA")
        .option("--refund-all-sol", "Gather Sol from bundler wallets to zombie wallet")
        .option("--check-wallets", "Check all wallets balances")
        .option("--sell-all", "Sell all tokens from all wallets")
        .option("--sell [wallet]", "Sell tokens for wallet numbers seperate comma. Number 0 indicates the minter's wallet. e.g, --sell 0,3,4")
        .action(async (options) => {
            if (Object.keys(options).length == 0) {
                console.log("Please see command help with `node app.js --help`")
            }
            if (options.simulate) {
                console.log("🚀 Starting to simulate...")
                await simulateBuyPumpfunTokens();
                console.log("🚩 End to simulate...")
            }
            if (options.launch) {
                figlet.textSync("PumpFun Token Launch")
                await buyPumpfunTokens();
                console.log("🚩 End to launch and first buy...")
            }
            if (options.genCA) {
                console.log("🚀 Staring to generate new PumpFun key...")
                await generatePumpfunKey();
                console.log("🚩 End to generate new PumpFun key...")
            }
            if (options.refundAllSol) {
                console.log("🚀 Refund all SOLs from wallets...")
                await gatherSol();
                console.log("🚩 End to refund SOLs...")
            }
            if (options.checkWallets) {
                console.log("🟢 Checking wallets for tokens...")
                await checkWallets();
                console.log("✅ Checking ended...")
            }
            if (options.sellAll) {
                console.log("🚀 Starting to sell tokens ...")
                await sellAllTokens();
                console.log("🚩 End to sell tokens ...")
            }
            if (options.sell) {
                if (options.sell) {
                    console.log("🚀 Starting to sell tokens ...")
                    let walletNumbers = options.sell.split(",");
                    await sellTokens(walletNumbers)
                    console.log("🚩 End to sell tokens ...")
                } else {
                    console.log("Please input numbers of wallet seperated with comma")
                }
            }
        })

    program.parse(process.argv).opts();
}
main()