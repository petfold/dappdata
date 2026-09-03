import { ethers } from 'ethers'
const p = new ethers.JsonRpcProvider(process.env.RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com')
const SBZZ = '0x543dDb01Ba47acB11de34891cD86B675F04840db', WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
const ROUTER = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E', QUOTER = '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3'
const router = new ethers.Contract(ROUTER, ['function WETH9() view returns (address)', 'function factory() view returns (address)'], p)
console.log('router code', (await p.getCode(ROUTER)).length > 2, 'WETH9', await router.WETH9(), 'factory', await router.factory())
const quoter = new ethers.Contract(QUOTER, ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)'], p)
for (const eth of ['0.005', '0.01', '0.02']) {
  const [out] = await quoter.quoteExactInputSingle.staticCall({ tokenIn: WETH, tokenOut: SBZZ, amountIn: ethers.parseEther(eth), fee: 3000, sqrtPriceLimitX96: 0 })
  console.log(`${eth} sETH -> ${ethers.formatUnits(out, 16)} sBZZ`)
}
