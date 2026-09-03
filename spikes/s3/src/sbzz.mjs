// S3: buys sBZZ on Uniswap V3 (Sepolia) with a throwaway key and sends it straight to the Bee node's wallet.
// Testnet only; the key file lives outside the repo (see keygen.mjs). Usage:
//   ETH=0.01 TO=0x13cB9947C508cf52a233a1E97d80Dd2485589481 node src/sbzz.mjs
import { ethers } from 'ethers'; import { readFileSync } from 'node:fs'
const p = new ethers.JsonRpcProvider(process.env.RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com')
const key = readFileSync(process.env.SWAP_KEY_FILE ?? `${process.env.HOME}/.dappdata-sepolia-swap.key`, 'utf8').trim()
const w = new ethers.Wallet(key, p)
const SBZZ = '0x543dDb01Ba47acB11de34891cD86B675F04840db', WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
const ROUTER = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E', QUOTER = '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3'
const amountIn = ethers.parseEther(process.env.ETH ?? '0.01'); const to = process.env.TO ?? w.address
const bal = await p.getBalance(w.address); console.log('swap wallet', w.address, 'balance', ethers.formatEther(bal), 'sETH')
if (bal < amountIn + ethers.parseEther('0.002')) { console.log('not enough sETH for the swap plus gas'); process.exit(1) }
const quoter = new ethers.Contract(QUOTER, ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)'], p)
const [quoted] = await quoter.quoteExactInputSingle.staticCall({ tokenIn: WETH, tokenOut: SBZZ, amountIn, fee: 3000, sqrtPriceLimitX96: 0 })
const minOut = quoted * 98n / 100n // 2% slippage
console.log(`swapping ${ethers.formatEther(amountIn)} sETH for >= ${ethers.formatUnits(minOut, 16)} sBZZ, recipient ${to}`)
const router = new ethers.Contract(ROUTER, ['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)'], w)
const tx = await router.exactInputSingle({ tokenIn: WETH, tokenOut: SBZZ, fee: 3000, recipient: to, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0 }, { value: amountIn })
console.log('tx', tx.hash); const rc = await tx.wait(); console.log('status', rc.status, 'block', rc.blockNumber, 'gas', rc.gasUsed.toString())
const erc20 = new ethers.Contract(SBZZ, ['function balanceOf(address) view returns (uint256)'], p)
console.log('recipient sBZZ balance now', ethers.formatUnits(await erc20.balanceOf(to), 16))
