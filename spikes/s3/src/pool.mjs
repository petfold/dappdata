import { ethers } from 'ethers'
const p = new ethers.JsonRpcProvider(process.env.RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com')
const SBZZ = '0x543dDb01Ba47acB11de34891cD86B675F04840db', WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
const erc20 = new ethers.Contract(SBZZ, ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)'], p)
console.log('token', await erc20.symbol(), 'decimals', await erc20.decimals(), 'supply', ethers.formatUnits(await erc20.totalSupply(), 16))
console.log('node sBZZ balance', ethers.formatUnits(await erc20.balanceOf('0x13cB9947C508cf52a233a1E97d80Dd2485589481'), 16), 'sETH', ethers.formatEther(await p.getBalance('0x13cB9947C508cf52a233a1E97d80Dd2485589481')))
const v3 = new ethers.Contract('0x0227628f3F023bb0B980b67D528571c95c6DaC1c', ['function getPool(address,address,uint24) view returns (address)'], p)
for (const fee of [100, 500, 3000, 10000]) { const pool = await v3.getPool(WETH, SBZZ, fee); if (pool !== ethers.ZeroAddress) { const c = new ethers.Contract(pool, ['function liquidity() view returns (uint128)', 'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)'], p); console.log('v3 pool fee', fee, pool, 'liquidity', (await c.liquidity()).toString(), 'tick', (await c.slot0())[1].toString()) } }
const v2 = new ethers.Contract('0xF62c03E08ada871A0bEb309762E260a7a6a880E6', ['function getPair(address,address) view returns (address)'], p)
const pair = await v2.getPair(WETH, SBZZ); console.log('v2 pair', pair)
if (pair !== ethers.ZeroAddress) { const c = new ethers.Contract(pair, ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)'], p); const [r0, r1] = await c.getReserves(); console.log('reserves', r0.toString(), r1.toString(), 'token0', await c.token0()) }
