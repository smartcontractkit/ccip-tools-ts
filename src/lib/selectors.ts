const selectors: Record<number, { readonly selector: bigint; readonly name?: string }> = {
  // generate:
  // fetch('https://github.com/smartcontractkit/chain-selectors/raw/main/selectors.yml')
  //   .then((res) => res.text())
  //   .then((body) => require('yaml').parse(body, { intAsBigInt: true }).selectors)
  //   .then((obj) => require('util').inspect(obj).split('\n').slice(1, -1))
  '1': { selector: 5009297550715157269n, name: 'ethereum-mainnet' },
  '10': {
    selector: 3734403246176062136n,
    name: 'ethereum-mainnet-optimism-1',
  },
  '25': { selector: 1456215246176062136n, name: 'cronos-mainnet' },
  '31': { selector: 8953668971247136127n, name: 'bitcoin-testnet-rootstock' },
  '40': { selector: 1477345371608778000n, name: 'telos-evm-mainnet' },
  '41': { selector: 729797994450396300n, name: 'telos-evm-testnet' },
  '45': {
    selector: 4340886533089894000n,
    name: 'polkadot-testnet-darwinia-pangoro',
  },
  '46': { selector: 8866418665544333000n, name: 'polkadot-mainnet-darwinia' },
  '52': {
    selector: 1761333065194157300n,
    name: 'coinex_smart_chain-mainnet',
  },
  '53': {
    selector: 8955032871639343000n,
    name: 'coinex_smart_chain-testnet',
  },
  '56': {
    selector: 11344663589394136015n,
    name: 'binance_smart_chain-mainnet',
  },
  '81': {
    selector: 6955638871347136141n,
    name: 'polkadot-testnet-astar-shibuya',
  },
  '97': {
    selector: 13264668187771770619n,
    name: 'binance_smart_chain-testnet',
  },
  '100': { selector: 465200170687744372n, name: 'gnosis_chain-mainnet' },
  '106': { selector: 374210358663784372n, name: 'velas-mainnet' },
  '111': { selector: 572210378683744374n, name: 'velas-testnet' },
  '137': { selector: 4051577828743386545n, name: 'polygon-mainnet' },
  '195': {
    selector: 2066098519157881736n,
    name: 'ethereum-testnet-sepolia-xlayer-1',
  },
  '196': { selector: 3016212468291539606n, name: 'ethereum-mainnet-xlayer-1' },
  '199': { selector: 3776006016387883143n, name: 'bittorrent_chain-mainnet' },
  '250': { selector: 3768048213127883732n, name: 'fantom-testnet-opera' },
  '252': { selector: 1462016016387883143n, name: 'fraxtal-mainnet' },
  '255': { selector: 3719320017875267166n, name: 'ethereum-mainnet-kroma-1' },
  '259': { selector: 8239338020728974000n, name: 'neonlink-mainnet' },
  '280': {
    selector: 6802309497652714138n,
    name: 'ethereum-testnet-goerli-zksync-1',
  },
  '282': { selector: 3842103497652714138n, name: 'cronos-testnet-zkevm-1' },
  '295': { selector: 3229138320728879060n, name: 'hedera-mainnet' },
  '296': { selector: 222782988166878823n, name: 'hedera-testnet' },
  '300': {
    selector: 6898391096552792247n,
    name: 'ethereum-testnet-sepolia-zksync-1',
  },
  '314': { selector: 4561443241176882990n, name: 'filecoin-mainnet' },
  '324': { selector: 1562403441176082196n, name: 'ethereum-mainnet-zksync-1' },
  '338': { selector: 2995292832068775165n, name: 'cronos-testnet' },
  '397': { selector: 2039744413822257700n, name: 'near-mainnet' },
  '398': { selector: 5061593697262339000n, name: 'near-testnet' },
  '420': {
    selector: 2664363617261496610n,
    name: 'ethereum-testnet-goerli-optimism-1',
  },
  '462': { selector: 7317911323415911000n, name: 'areon-testnet' },
  '463': { selector: 1939936305787790600n, name: 'areon-mainnet' },
  '592': { selector: 6422105447186081193n, name: 'polkadot-mainnet-astar' },
  '919': {
    selector: 829525985033418733n,
    name: 'ethereum-testnet-sepolia-mode-1',
  },
  '1029': { selector: 4459371029167934217n, name: 'bittorrent_chain-testnet' },
  '1088': { selector: 8805746078405598895n, name: 'ethereum-mainnet-metis-1' },
  '1101': {
    selector: 4348158687435793198n,
    name: 'ethereum-mainnet-polygon-zkevm-1',
  },
  '1111': { selector: 5142893604156789321n, name: 'wemix-mainnet' },
  '1112': { selector: 9284632837123596123n, name: 'wemix-testnet' },
  '1284': { selector: 1252863800116739621n, name: 'polkadot-mainnet-moonbeam' },
  '1285': { selector: 1355020143337428062n, name: 'kusama-mainnet-moonriver' },
  '1287': {
    selector: 5361632739113536121n,
    name: 'polkadot-testnet-moonbeam-moonbase',
  },
  '1337': { selector: 3379446385462418246n, name: 'geth-testnet' },
  '1442': {
    selector: 11059667695644972511n,
    name: 'ethereum-testnet-goerli-polygon-zkevm-1',
  },
  '1907': { selector: 4874388048629246000n, name: 'bitcichain-mainnet' },
  '1908': { selector: 4888058894222120000n, name: 'bitcichain-testnet' },
  '1946': {
    selector: 686603546605904534n,
    name: 'ethereum-testnet-sepolia-soneium-1',
  },
  '2031': {
    selector: 8175830712062617656n,
    name: 'polkadot-mainnet-centrifuge',
  },
  '2088': {
    selector: 2333097300889804761n,
    name: 'polkadot-testnet-centrifuge-altair',
  },
  '2221': { selector: 2110537777356199208n, name: 'kava-testnet' },
  '2222': { selector: 7550000543357438061n, name: 'kava-mainnet' },
  '2358': {
    selector: 5990477251245693094n,
    name: 'ethereum-testnet-sepolia-kroma-1',
  },
  '2442': {
    selector: 1654667687261492630n,
    name: 'ethereum-testnet-sepolia-polygon-zkevm-1',
  },
  '2522': {
    selector: 8901520481741771655n,
    name: 'ethereum-testnet-holesky-fraxtal-1',
  },
  '2810': {
    selector: 8304510386741731151n,
    name: 'ethereum-testnet-holesky-morph-1',
  },
  '3636': { selector: 1467223411771711614n, name: 'bitcoin-testnet-botanix' },
  '3637': { selector: 4560701533377838164n, name: 'bitcoin-mainnet-botanix' },
  '3776': {
    selector: 1540201334317828111n,
    name: 'ethereum-mainnet-astar-zkevm-1',
  },
  '4002': { selector: 4905564228793744293n, name: 'fantom-testnet' },
  '4200': { selector: 241851231317828981n, name: 'bitcoin-merlin-mainnet' },
  '4202': {
    selector: 5298399861320400553n,
    name: 'ethereum-testnet-sepolia-lisk-1',
  },
  '5000': { selector: 1556008542357238666n, name: 'ethereum-mainnet-mantle-1' },
  '5001': {
    selector: 4168263376276232250n,
    name: 'ethereum-testnet-goerli-mantle-1',
  },
  '5003': {
    selector: 8236463271206331221n,
    name: 'ethereum-testnet-sepolia-mantle-1',
  },
  '8453': { selector: 15971525489660198786n, name: 'ethereum-mainnet-base-1' },
  '9559': { selector: 1113014352258747600n, name: 'neonlink-testnet' },
  '10200': {
    selector: 8871595565390010547n,
    name: 'gnosis_chain-testnet-chiado',
  },
  '12324': {
    selector: 3162193654116181371n,
    name: 'ethereum-mainnet-arbitrum-1-l3x-1',
  },
  '12325': {
    selector: 3486622437121596122n,
    name: 'ethereum-testnet-sepolia-arbitrum-1-l3x-1',
  },
  '13371': {
    selector: 1237925231416731909n,
    name: 'ethereum-mainnet-immutable-zkevm-1',
  },
  '13473': {
    selector: 4526165231216331901n,
    name: 'ethereum-testnet-sepolia-immutable-zkevm-1',
  },
  '34443': { selector: 7264351850409363825n, name: 'ethereum-mainnet-mode-1' },
  '42161': {
    selector: 4949039107694359620n,
    name: 'ethereum-mainnet-arbitrum-1',
  },
  '42220': { selector: 1346049177634351622n, name: 'celo-mainnet' },
  '43113': { selector: 14767482510784806043n, name: 'avalanche-testnet-fuji' },
  '43114': { selector: 6433500567565415381n, name: 'avalanche-mainnet' },
  '44787': { selector: 3552045678561919002n, name: 'celo-testnet-alfajores' },
  '45439': { selector: 8446413392851542429n, name: 'private-testnet-opala' },
  '48899': {
    selector: 4562743618362911021n,
    name: 'ethereum-testnet-sepolia-zircuit-1',
  },
  '48900': {
    selector: 17198166215261833993n,
    name: 'ethereum-mainnet-zircuit-1',
  },
  '59140': {
    selector: 1355246678561316402n,
    name: 'ethereum-testnet-goerli-linea-1',
  },
  '59141': {
    selector: 5719461335882077547n,
    name: 'ethereum-testnet-sepolia-linea-1',
  },
  '59144': { selector: 4627098889531055414n, name: 'ethereum-mainnet-linea-1' },
  '59902': {
    selector: 3777822886988675105n,
    name: 'ethereum-testnet-sepolia-metis-1',
  },
  '76578': { selector: 781901677223027175n },
  '80001': { selector: 12532609583862916517n, name: 'polygon-testnet-mumbai' },
  '80002': { selector: 16281711391670634445n, name: 'polygon-testnet-amoy' },
  '80085': { selector: 12336603543561911511n, name: 'berachain-testnet-artio' },
  '81457': { selector: 4411394078118774322n, name: 'ethereum-mainnet-blast-1' },
  '84531': {
    selector: 5790810961207155433n,
    name: 'ethereum-testnet-goerli-base-1',
  },
  '84532': {
    selector: 10344971235874465080n,
    name: 'ethereum-testnet-sepolia-base-1',
  },
  '421613': {
    selector: 6101244977088475029n,
    name: 'ethereum-testnet-goerli-arbitrum-1',
  },
  '421614': {
    selector: 3478487238524512106n,
    name: 'ethereum-testnet-sepolia-arbitrum-1',
  },
  '424242': { selector: 4489326297382772450n, name: 'private-testnet-mica' },
  '432201': {
    selector: 1458281248224512906n,
    name: 'avalanche-subnet-dexalot-testnet',
  },
  '432204': {
    selector: 5463201557265485081n,
    name: 'avalanche-subnet-dexalot-mainnet',
  },
  '534351': {
    selector: 2279865765895943307n,
    name: 'ethereum-testnet-sepolia-scroll-1',
  },
  '534352': {
    selector: 13204309965629103672n,
    name: 'ethereum-mainnet-scroll-1',
  },
  '595581': { selector: 7837562506228496256n, name: 'avalanche-testnet-nexon' },
  '686868': { selector: 5269261765892944301n, name: 'bitcoin-testnet-merlin' },
  '717160': {
    selector: 4418231248214522936n,
    name: 'ethereum-testnet-sepolia-polygon-validium-1',
  },
  '810180': { selector: 4350319965322101699n, name: 'zklink_nova-mainnet' },
  '810181': { selector: 5837261596322416298n, name: 'zklink_nova-testnet' },
  '978657': {
    selector: 10443705513486043421n,
    name: 'ethereum-testnet-sepolia-arbitrum-1-treasure-1',
  },
  '978670': {
    selector: 1010349088906777999n,
    name: 'ethereum-mainnet-arbitrum-1-treasure-1',
  },
  '11155111': { selector: 16015286601757825753n, name: 'ethereum-testnet-sepolia' },
  '11155420': {
    selector: 5224473277236331295n,
    name: 'ethereum-testnet-sepolia-optimism-1',
  },
  '21000000': {
    selector: 1467427327723633929n,
    name: 'ethereum-testnet-sepolia-corn-1',
  },
  '31415926': { selector: 7060342227814389000n, name: 'filecoin-testnet' },
  '168587773': {
    selector: 2027362563942762617n,
    name: 'ethereum-testnet-sepolia-blast-1',
  },
  // end:generate
}
export default selectors
