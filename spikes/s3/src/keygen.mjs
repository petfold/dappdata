// Makes a throwaway Sepolia key for the S3 swap. Key file lives outside the repo (CLAUDE.md rule 5). Prints the address only.
import { ethers } from 'ethers'; import { writeFileSync, existsSync, chmodSync } from 'node:fs'
const file = process.env.SWAP_KEY_FILE ?? `${process.env.HOME}/.dappdata-sepolia-swap.key`
if (!existsSync(file)) { const w = ethers.Wallet.createRandom(); writeFileSync(file, w.privateKey + '\n'); chmodSync(file, 0o600); console.log('created', file) }
console.log('address', new ethers.Wallet((await import('node:fs')).readFileSync(file, 'utf8').trim()).address)
