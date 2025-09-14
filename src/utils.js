const { Keypair } = require("@solana/web3.js");
const bs58 = require('bs58');


const getRandomNumber = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const getKeypairFromBase58 = (pk) => {
    return Keypair.fromSecretKey(bs58.decode(pk));
}

module.exports = {
    getKeypairFromBase58,
    getRandomNumber
}