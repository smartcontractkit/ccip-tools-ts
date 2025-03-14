type Selectors = Record<number, { readonly selector: bigint; readonly name?: string }>

const evmSelectors: Selectors = {
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
  '30': { selector: 11964252391146578476n, name: 'rootstock-mainnet' },
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
  '109': { selector: 3993510008929295315n, name: 'shibarium-mainnet' },
  '111': { selector: 572210378683744374n, name: 'velas-testnet' },
  '130': {
    selector: 1923510103922296319n,
    name: 'ethereum-mainnet-unichain-1',
  },
  '133': {
    selector: 4356164186791070119n,
    name: 'ethereum-testnet-sepolia-hashkey-1',
  },
  '137': { selector: 4051577828743386545n, name: 'polygon-mainnet' },
  '146': { selector: 1673871237479749969n, name: 'sonic-mainnet' },
  '157': {
    selector: 17833296867764334567n,
    name: 'shibarium-testnet-puppynet',
  },
  '177': {
    selector: 7613811247471741961n,
    name: 'ethereum-mainnet-hashkey-1',
  },
  '195': {
    selector: 2066098519157881736n,
    name: 'ethereum-testnet-sepolia-xlayer-1',
  },
  '196': { selector: 3016212468291539606n, name: 'ethereum-mainnet-xlayer-1' },
  '199': { selector: 3776006016387883143n, name: 'bittorrent_chain-mainnet' },
  '204': {
    selector: 465944652040885897n,
    name: 'binance_smart_chain-mainnet-opbnb-1',
  },
  '223': {
    selector: 5406759801798337480n,
    name: 'bitcoin-mainnet-bsquared-1',
  },
  '228': { selector: 11690709103138290329n, name: 'mind-mainnet' },
  '232': { selector: 5608378062013572713n, name: 'lens-mainnet' },
  '240': {
    selector: 16487132492576884721n,
    name: 'cronos-zkevm-testnet-sepolia',
  },
  '250': { selector: 3768048213127883732n, name: 'fantom-mainnet' },
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
  '388': { selector: 8788096068760390840n, name: 'cronos-zkevm-mainnet' },
  '397': { selector: 2039744413822257700n, name: 'near-mainnet' },
  '398': { selector: 5061593697262339000n, name: 'near-testnet' },
  '420': {
    selector: 2664363617261496610n,
    name: 'ethereum-testnet-goerli-optimism-1',
  },
  '462': { selector: 7317911323415911000n, name: 'areon-testnet' },
  '463': { selector: 1939936305787790600n, name: 'areon-mainnet' },
  '480': {
    selector: 2049429975587534727n,
    name: 'ethereum-mainnet-worldchain-1',
  },
  '592': { selector: 6422105447186081193n, name: 'polkadot-mainnet-astar' },
  '919': {
    selector: 829525985033418733n,
    name: 'ethereum-testnet-sepolia-mode-1',
  },
  '998': { selector: 4286062357653186312n, name: 'hyperliquid-testnet' },
  '1029': { selector: 4459371029167934217n, name: 'bittorrent_chain-testnet' },
  '1088': { selector: 8805746078405598895n, name: 'ethereum-mainnet-metis-1' },
  '1101': {
    selector: 4348158687435793198n,
    name: 'ethereum-mainnet-polygon-zkevm-1',
  },
  '1111': { selector: 5142893604156789321n, name: 'wemix-mainnet' },
  '1112': { selector: 9284632837123596123n, name: 'wemix-testnet' },
  '1114': { selector: 4264732132125536123n, name: 'core-testnet' },
  '1116': { selector: 1224752112135636129n, name: 'core-mainnet' },
  '1123': {
    selector: 1948510578179542068n,
    name: 'bitcoin-testnet-bsquared-1',
  },
  '1284': { selector: 1252863800116739621n, name: 'polkadot-mainnet-moonbeam' },
  '1285': { selector: 1355020143337428062n, name: 'kusama-mainnet-moonriver' },
  '1287': {
    selector: 5361632739113536121n,
    name: 'polkadot-testnet-moonbeam-moonbase',
  },
  '1301': {
    selector: 14135854469784514356n,
    name: 'ethereum-testnet-sepolia-unichain-1',
  },
  '1328': { selector: 1216300075444106652n, name: 'sei-testnet-atlantic' },
  '1329': { selector: 9027416829622342829n, name: 'sei-mainnet' },
  '1337': { selector: 3379446385462418246n, name: 'geth-testnet' },
  '1338': { selector: 2181150070347029680n },
  '1442': {
    selector: 11059667695644972511n,
    name: 'ethereum-testnet-goerli-polygon-zkevm-1',
  },
  '1513': { selector: 4237030917318060427n, name: 'story-testnet' },
  '1868': { selector: 12505351618335765396n, name: 'soneium-mainnet' },
  '1907': { selector: 4874388048629246000n, name: 'bitcichain-mainnet' },
  '1908': { selector: 4888058894222120000n, name: 'bitcichain-testnet' },
  '1946': {
    selector: 686603546605904534n,
    name: 'ethereum-testnet-sepolia-soneium-1',
  },
  '2020': { selector: 6916147374840168594n, name: 'ronin-mainnet' },
  '2021': { selector: 13116810400804392105n, name: 'ronin-testnet-saigon' },
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
  '2818': { selector: 18164309074156128038n, name: 'morph-mainnet' },
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
  '4801': {
    selector: 5299555114858065850n,
    name: 'ethereum-testnet-sepolia-worldchain-1',
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
  '5611': {
    selector: 13274425992935471758n,
    name: 'binance_smart_chain-testnet-opbnb-1',
  },
  '6342': { selector: 2443239559770384419n, name: 'megaeth-testnet' },
  '8453': { selector: 15971525489660198786n, name: 'ethereum-mainnet-base-1' },
  '9559': { selector: 1113014352258747600n, name: 'neonlink-testnet' },
  '10143': { selector: 2183018362218727504n, name: 'monad-testnet' },
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
  '16600': { selector: 16088006396410204581n, name: '0g-testnet-newton' },
  '17000': { selector: 7717148896336251131n, name: 'ethereum-testnet-holesky' },
  '33111': { selector: 9900119385908781505n, name: 'apechain-testnet-curtis' },
  '33139': { selector: 14894068710063348487n, name: 'apechain-mainnet' },
  '34443': { selector: 7264351850409363825n, name: 'ethereum-mainnet-mode-1' },
  '37111': {
    selector: 6827576821754315911n,
    name: 'ethereum-testnet-sepolia-lens-1',
  },
  '42161': {
    selector: 4949039107694359620n,
    name: 'ethereum-mainnet-arbitrum-1',
  },
  '42220': { selector: 1346049177634351622n, name: 'celo-mainnet' },
  '43111': { selector: 1804312132722180201n, name: 'hemi-mainnet' },
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
  '57054': { selector: 3676871237479449268n, name: 'sonic-testnet-blaze' },
  '57073': { selector: 3461204551265785888n, name: 'ethereum-mainnet-ink-1' },
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
  '60808': { selector: 3849287863852499584n, name: 'bitcoin-mainnet-bob-1' },
  '61166': { selector: 5214452172935136222n, name: 'treasure-mainnet' },
  '76578': { selector: 781901677223027175n },
  '80001': { selector: 12532609583862916517n, name: 'polygon-testnet-mumbai' },
  '80002': { selector: 16281711391670634445n, name: 'polygon-testnet-amoy' },
  '80069': { selector: 7728255861635209484n, name: 'berachain-testnet-bepolia' },
  '80084': { selector: 8999465244383784164n, name: 'berachain-testnet-bartio' },
  '80085': { selector: 12336603543561911511n, name: 'berachain-testnet-artio' },
  '80094': { selector: 1294465214383781161n, name: 'berachain-mainnet' },
  '81457': { selector: 4411394078118774322n, name: 'ethereum-mainnet-blast-1' },
  '84531': {
    selector: 5790810961207155433n,
    name: 'ethereum-testnet-goerli-base-1',
  },
  '84532': {
    selector: 10344971235874465080n,
    name: 'ethereum-testnet-sepolia-base-1',
  },
  '98864': { selector: 3743020999916460931n, name: 'plume-devnet' },
  '98865': { selector: 3208172210661564830n, name: 'plume-mainnet' },
  '167000': { selector: 16468599424800719238n, name: 'ethereum-mainnet-taiko-1' },
  '167009': {
    selector: 7248756420937879088n,
    name: 'ethereum-testnet-holesky-taiko-1',
  },
  '192940': { selector: 7189150270347329685n, name: 'mind-testnet' },
  '200810': {
    selector: 3789623672476206327n,
    name: 'bitcoin-testnet-bitlayer-1',
  },
  '200901': {
    selector: 7937294810946806131n,
    name: 'bitcoin-mainnet-bitlayer-1',
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
  '743111': { selector: 16126893759944359622n, name: 'hemi-testnet-sepolia' },
  '763373': { selector: 9763904284804119144n, name: 'ink-testnet-sepolia' },
  '808813': {
    selector: 5535534526963509396n,
    name: 'bitcoin-testnet-sepolia-bob-1',
  },
  '810180': { selector: 4350319965322101699n, name: 'zklink_nova-mainnet' },
  '810181': { selector: 5837261596322416298n, name: 'zklink_nova-testnet' },
  '978657': {
    selector: 10443705513486043421n,
    name: 'ethereum-testnet-sepolia-arbitrum-1-treasure-1',
  },
  '978658': { selector: 3676916124122457866n, name: 'treasure-testnet-topaz' },
  '978670': {
    selector: 1010349088906777999n,
    name: 'ethereum-mainnet-arbitrum-1-treasure-1',
  },
  '11155111': { selector: 16015286601757825753n, name: 'ethereum-testnet-sepolia' },
  '11155420': {
    selector: 5224473277236331295n,
    name: 'ethereum-testnet-sepolia-optimism-1',
  },
  '21000000': { selector: 9043146809313071210n, name: 'corn-mainnet' },
  '21000001': {
    selector: 1467427327723633929n,
    name: 'ethereum-testnet-sepolia-corn-1',
  },
  '31415926': { selector: 7060342227814389000n, name: 'filecoin-testnet' },
  '161221135': { selector: 14684575664602284776n, name: 'plume-testnet' },
  '168587773': {
    selector: 2027362563942762617n,
    name: 'ethereum-testnet-sepolia-blast-1',
  },
  // end:generate
}

export const aptosSelectors: Selectors = {
  '1': { name: 'aptos-mainnet', selector: 4741433654826277614n },
  '2': { name: 'aptos-testnet', selector: 743186221051783445n },
  '4': { name: 'aptos-localnet', selector: 4457093679053095497n },
}

const selectors: Selectors = { ...evmSelectors, ...aptosSelectors }

export const isAptosChain = (selector: bigint): boolean => {
  return Object.values(aptosSelectors).some((aptosSelector) => aptosSelector.selector === selector)
}

export default selectors
