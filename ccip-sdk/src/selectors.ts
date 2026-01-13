import type { ChainFamily } from './types.ts'

type Selectors = Record<
  string,
  { readonly selector: bigint; readonly name?: string; family: ChainFamily }
>

const selectors: Selectors = {
  // generate:
  // fetch('https://github.com/smartcontractkit/chain-selectors/raw/main/selectors.yml')
  //   .then((res) => res.text())
  //   .then((body) => require('yaml').parse(body, { intAsBigInt: true }).selectors)
  //   .then((obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { ...v, family: 'evm' }])))
  //   .then((obj) => [...require('util').inspect(obj).split('\n').slice(1, -1), ','])
  '1': {
    selector: 5009297550715157269n,
    name: 'ethereum-mainnet',
    family: 'evm',
  },
  '10': {
    selector: 3734403246176062136n,
    name: 'ethereum-mainnet-optimism-1',
    family: 'evm',
  },
  '25': {
    selector: 1456215246176062136n,
    name: 'cronos-mainnet',
    family: 'evm',
  },
  '30': {
    selector: 11964252391146578476n,
    name: 'rootstock-mainnet',
    family: 'evm',
  },
  '31': {
    selector: 8953668971247136127n,
    name: 'bitcoin-testnet-rootstock',
    family: 'evm',
  },
  '40': {
    selector: 1477345371608778000n,
    name: 'telos-evm-mainnet',
    family: 'evm',
  },
  '41': {
    selector: 729797994450396300n,
    name: 'telos-evm-testnet',
    family: 'evm',
  },
  '45': {
    selector: 4340886533089894000n,
    name: 'polkadot-testnet-darwinia-pangoro',
    family: 'evm',
  },
  '46': {
    selector: 8866418665544333000n,
    name: 'polkadot-mainnet-darwinia',
    family: 'evm',
  },
  '50': {
    selector: 17673274061779414707n,
    name: 'xdc-mainnet',
    family: 'evm',
  },
  '51': {
    selector: 3017758115101368649n,
    name: 'xdc-testnet',
    family: 'evm',
  },
  '52': {
    selector: 1761333065194157300n,
    name: 'coinex_smart_chain-mainnet',
    family: 'evm',
  },
  '53': {
    selector: 8955032871639343000n,
    name: 'coinex_smart_chain-testnet',
    family: 'evm',
  },
  '56': {
    selector: 11344663589394136015n,
    name: 'binance_smart_chain-mainnet',
    family: 'evm',
  },
  '81': {
    selector: 6955638871347136141n,
    name: 'polkadot-testnet-astar-shibuya',
    family: 'evm',
  },
  '85': {
    selector: 3558960680482140165n,
    name: 'gate-chain-testnet-meteora',
    family: 'evm',
  },
  '86': {
    selector: 9688382747979139404n,
    name: 'gate-chain-mainnet',
    family: 'evm',
  },
  '97': {
    selector: 13264668187771770619n,
    name: 'binance_smart_chain-testnet',
    family: 'evm',
  },
  '100': {
    selector: 465200170687744372n,
    name: 'gnosis_chain-mainnet',
    family: 'evm',
  },
  '106': {
    selector: 374210358663784372n,
    name: 'velas-mainnet',
    family: 'evm',
  },
  '109': {
    selector: 3993510008929295315n,
    name: 'shibarium-mainnet',
    family: 'evm',
  },
  '111': {
    selector: 572210378683744374n,
    name: 'velas-testnet',
    family: 'evm',
  },
  '130': {
    selector: 1923510103922296319n,
    name: 'ethereum-mainnet-unichain-1',
    family: 'evm',
  },
  '133': {
    selector: 4356164186791070119n,
    name: 'ethereum-testnet-sepolia-hashkey-1',
    family: 'evm',
  },
  '137': {
    selector: 4051577828743386545n,
    name: 'polygon-mainnet',
    family: 'evm',
  },
  '143': {
    selector: 8481857512324358265n,
    name: 'monad-mainnet',
    family: 'evm',
  },
  '146': {
    selector: 1673871237479749969n,
    name: 'sonic-mainnet',
    family: 'evm',
  },
  '157': {
    selector: 17833296867764334567n,
    name: 'shibarium-testnet-puppynet',
    family: 'evm',
  },
  '177': {
    selector: 7613811247471741961n,
    name: 'ethereum-mainnet-hashkey-1',
    family: 'evm',
  },
  '185': {
    selector: 17164792800244661392n,
    name: 'mint-mainnet',
    family: 'evm',
  },
  '195': {
    selector: 2066098519157881736n,
    name: 'ethereum-testnet-sepolia-xlayer-1',
    family: 'evm',
  },
  '196': {
    selector: 3016212468291539606n,
    name: 'ethereum-mainnet-xlayer-1',
    family: 'evm',
  },
  '199': {
    selector: 3776006016387883143n,
    name: 'bittorrent_chain-mainnet',
    family: 'evm',
  },
  '204': {
    selector: 465944652040885897n,
    name: 'binance_smart_chain-mainnet-opbnb-1',
    family: 'evm',
  },
  '223': {
    selector: 5406759801798337480n,
    name: 'bitcoin-mainnet-bsquared-1',
    family: 'evm',
  },
  '228': {
    selector: 11690709103138290329n,
    name: 'mind-mainnet',
    family: 'evm',
  },
  '232': {
    selector: 5608378062013572713n,
    name: 'lens-mainnet',
    family: 'evm',
  },
  '239': {
    selector: 5936861837188149645n,
    name: 'tac-mainnet',
    family: 'evm',
  },
  '240': {
    selector: 16487132492576884721n,
    name: 'cronos-zkevm-testnet-sepolia',
    family: 'evm',
  },
  '250': {
    selector: 3768048213127883732n,
    name: 'fantom-mainnet',
    family: 'evm',
  },
  '252': {
    selector: 1462016016387883143n,
    name: 'fraxtal-mainnet',
    family: 'evm',
  },
  '255': {
    selector: 3719320017875267166n,
    name: 'ethereum-mainnet-kroma-1',
    family: 'evm',
  },
  '259': {
    selector: 8239338020728974000n,
    name: 'neonlink-mainnet',
    family: 'evm',
  },
  '280': {
    selector: 6802309497652714138n,
    name: 'ethereum-testnet-goerli-zksync-1',
    family: 'evm',
  },
  '282': {
    selector: 3842103497652714138n,
    name: 'cronos-testnet-zkevm-1',
    family: 'evm',
  },
  '295': {
    selector: 3229138320728879060n,
    name: 'hedera-mainnet',
    family: 'evm',
  },
  '296': {
    selector: 222782988166878823n,
    name: 'hedera-testnet',
    family: 'evm',
  },
  '300': {
    selector: 6898391096552792247n,
    name: 'ethereum-testnet-sepolia-zksync-1',
    family: 'evm',
  },
  '314': {
    selector: 4561443241176882990n,
    name: 'filecoin-mainnet',
    family: 'evm',
  },
  '324': {
    selector: 1562403441176082196n,
    name: 'ethereum-mainnet-zksync-1',
    family: 'evm',
  },
  '338': {
    selector: 2995292832068775165n,
    name: 'cronos-testnet',
    family: 'evm',
  },
  '388': {
    selector: 8788096068760390840n,
    name: 'cronos-zkevm-mainnet',
    family: 'evm',
  },
  '397': {
    selector: 2039744413822257700n,
    name: 'near-mainnet',
    family: 'evm',
  },
  '398': {
    selector: 5061593697262339000n,
    name: 'near-testnet',
    family: 'evm',
  },
  '420': {
    selector: 2664363617261496610n,
    name: 'ethereum-testnet-goerli-optimism-1',
    family: 'evm',
  },
  '462': {
    selector: 7317911323415911000n,
    name: 'areon-testnet',
    family: 'evm',
  },
  '463': {
    selector: 1939936305787790600n,
    name: 'areon-mainnet',
    family: 'evm',
  },
  '480': {
    selector: 2049429975587534727n,
    name: 'ethereum-mainnet-worldchain-1',
    family: 'evm',
  },
  '592': {
    selector: 6422105447186081193n,
    name: 'polkadot-mainnet-astar',
    family: 'evm',
  },
  '678': {
    selector: 9107126442626377432n,
    name: 'janction-mainnet',
    family: 'evm',
  },
  '679': {
    selector: 5059197667603797935n,
    name: 'janction-testnet-sepolia',
    family: 'evm',
  },
  '682': {
    selector: 6260932437388305511n,
    name: 'private-testnet-obsidian',
    family: 'evm',
  },
  '919': {
    selector: 829525985033418733n,
    name: 'ethereum-testnet-sepolia-mode-1',
    family: 'evm',
  },
  '945': {
    selector: 2177900824115119161n,
    name: 'bittensor-testnet',
    family: 'evm',
  },
  '964': {
    selector: 2135107236357186872n,
    name: 'bittensor-mainnet',
    family: 'evm',
  },
  '988': {
    selector: 16978377838628290997n,
    name: 'stable-mainnet',
    family: 'evm',
  },
  '998': {
    selector: 4286062357653186312n,
    name: 'hyperliquid-testnet',
    family: 'evm',
  },
  '999': {
    selector: 2442541497099098535n,
    name: 'hyperliquid-mainnet',
    family: 'evm',
  },
  '1001': {
    selector: 2624132734533621656n,
    name: 'kaia-testnet-kairos',
    family: 'evm',
  },
  '1029': {
    selector: 4459371029167934217n,
    name: 'bittorrent_chain-testnet',
    family: 'evm',
  },
  '1030': {
    selector: 3358365939762719202n,
    name: 'conflux-mainnet',
    family: 'evm',
  },
  '1088': {
    selector: 8805746078405598895n,
    name: 'ethereum-mainnet-metis-1',
    family: 'evm',
  },
  '1101': {
    selector: 4348158687435793198n,
    name: 'ethereum-mainnet-polygon-zkevm-1',
    family: 'evm',
  },
  '1111': {
    selector: 5142893604156789321n,
    name: 'wemix-mainnet',
    family: 'evm',
  },
  '1112': {
    selector: 9284632837123596123n,
    name: 'wemix-testnet',
    family: 'evm',
  },
  '1114': {
    selector: 4264732132125536123n,
    name: 'core-testnet',
    family: 'evm',
  },
  '1116': {
    selector: 1224752112135636129n,
    name: 'core-mainnet',
    family: 'evm',
  },
  '1123': {
    selector: 1948510578179542068n,
    name: 'bitcoin-testnet-bsquared-1',
    family: 'evm',
  },
  '1135': {
    selector: 15293031020466096408n,
    name: 'lisk-mainnet',
    family: 'evm',
  },
  '1284': {
    selector: 1252863800116739621n,
    name: 'polkadot-mainnet-moonbeam',
    family: 'evm',
  },
  '1285': {
    selector: 1355020143337428062n,
    name: 'kusama-mainnet-moonriver',
    family: 'evm',
  },
  '1287': {
    selector: 5361632739113536121n,
    name: 'polkadot-testnet-moonbeam-moonbase',
    family: 'evm',
  },
  '1301': {
    selector: 14135854469784514356n,
    name: 'ethereum-testnet-sepolia-unichain-1',
    family: 'evm',
  },
  '1328': {
    selector: 1216300075444106652n,
    name: 'sei-testnet-atlantic',
    family: 'evm',
  },
  '1329': {
    selector: 9027416829622342829n,
    name: 'sei-mainnet',
    family: 'evm',
  },
  '1337': {
    selector: 3379446385462418246n,
    name: 'geth-testnet',
    family: 'evm',
  },
  '1338': { selector: 2181150070347029680n, family: 'evm' },
  '1442': {
    selector: 11059667695644972511n,
    name: 'ethereum-testnet-goerli-polygon-zkevm-1',
    family: 'evm',
  },
  '1513': {
    selector: 4237030917318060427n,
    name: 'story-testnet',
    family: 'evm',
  },
  '1672': {
    selector: 7801139999541420232n,
    name: 'pharos-mainnet',
    family: 'evm',
  },
  '1687': {
    selector: 10749384167430721561n,
    name: 'mint-testnet',
    family: 'evm',
  },
  '1740': {
    selector: 6286293440461807648n,
    name: 'metal-testnet',
    family: 'evm',
  },
  '1750': {
    selector: 13447077090413146373n,
    name: 'metal-mainnet',
    family: 'evm',
  },
  '1868': {
    selector: 12505351618335765396n,
    name: 'soneium-mainnet',
    family: 'evm',
  },
  '1907': {
    selector: 4874388048629246000n,
    name: 'bitcichain-mainnet',
    family: 'evm',
  },
  '1908': {
    selector: 4888058894222120000n,
    name: 'bitcichain-testnet',
    family: 'evm',
  },
  '1946': {
    selector: 686603546605904534n,
    name: 'ethereum-testnet-sepolia-soneium-1',
    family: 'evm',
  },
  '1952': {
    selector: 10212741611335999305n,
    name: 'xlayer-testnet',
    family: 'evm',
  },
  '2020': {
    selector: 6916147374840168594n,
    name: 'ronin-mainnet',
    family: 'evm',
  },
  '2021': {
    selector: 13116810400804392105n,
    name: 'ronin-testnet-saigon',
    family: 'evm',
  },
  '2023': {
    selector: 3260900564719373474n,
    name: 'private-testnet-granite',
    family: 'evm',
  },
  '2024': {
    selector: 6915682381028791124n,
    name: 'private-testnet-andesite',
    family: 'evm',
  },
  '2025': {
    selector: 15513093881969820114n,
    name: 'dtcc-testnet-andesite',
    family: 'evm',
  },
  '2031': {
    selector: 8175830712062617656n,
    name: 'polkadot-mainnet-centrifuge',
    family: 'evm',
  },
  '2088': {
    selector: 2333097300889804761n,
    name: 'polkadot-testnet-centrifuge-altair',
    family: 'evm',
  },
  '2129': {
    selector: 12168171414969487009n,
    name: 'memento-testnet',
    family: 'evm',
  },
  '2201': {
    selector: 11793402411494852765n,
    name: 'stable-testnet',
    family: 'evm',
  },
  '2221': {
    selector: 2110537777356199208n,
    name: 'kava-testnet',
    family: 'evm',
  },
  '2222': {
    selector: 7550000543357438061n,
    name: 'kava-mainnet',
    family: 'evm',
  },
  '2358': {
    selector: 5990477251245693094n,
    name: 'ethereum-testnet-sepolia-kroma-1',
    family: 'evm',
  },
  '2391': {
    selector: 9488606126177218005n,
    name: 'tac-testnet',
    family: 'evm',
  },
  '2442': {
    selector: 1654667687261492630n,
    name: 'ethereum-testnet-sepolia-polygon-zkevm-1',
    family: 'evm',
  },
  '2522': {
    selector: 8901520481741771655n,
    name: 'ethereum-testnet-holesky-fraxtal-1',
    family: 'evm',
  },
  '2741': {
    selector: 3577778157919314504n,
    name: 'abstract-mainnet',
    family: 'evm',
  },
  '2810': {
    selector: 8304510386741731151n,
    name: 'ethereum-testnet-holesky-morph-1',
    family: 'evm',
  },
  '2818': {
    selector: 18164309074156128038n,
    name: 'morph-mainnet',
    family: 'evm',
  },
  '2910': {
    selector: 1064004874793747259n,
    name: 'ethereum-testnet-hoodi-morph',
    family: 'evm',
  },
  '3636': {
    selector: 1467223411771711614n,
    name: 'bitcoin-testnet-botanix',
    family: 'evm',
  },
  '3637': {
    selector: 4560701533377838164n,
    name: 'bitcoin-mainnet-botanix',
    family: 'evm',
  },
  '3776': {
    selector: 1540201334317828111n,
    name: 'ethereum-mainnet-astar-zkevm-1',
    family: 'evm',
  },
  '4002': {
    selector: 4905564228793744293n,
    name: 'fantom-testnet',
    family: 'evm',
  },
  '4200': {
    selector: 241851231317828981n,
    name: 'bitcoin-merlin-mainnet',
    family: 'evm',
  },
  '4202': {
    selector: 5298399861320400553n,
    name: 'ethereum-testnet-sepolia-lisk-1',
    family: 'evm',
  },
  '4326': {
    selector: 6093540873831549674n,
    name: 'megaeth-mainnet',
    family: 'evm',
  },
  '4801': {
    selector: 5299555114858065850n,
    name: 'ethereum-testnet-sepolia-worldchain-1',
    family: 'evm',
  },
  '5000': {
    selector: 1556008542357238666n,
    name: 'ethereum-mainnet-mantle-1',
    family: 'evm',
  },
  '5001': {
    selector: 4168263376276232250n,
    name: 'ethereum-testnet-goerli-mantle-1',
    family: 'evm',
  },
  '5003': {
    selector: 8236463271206331221n,
    name: 'ethereum-testnet-sepolia-mantle-1',
    family: 'evm',
  },
  '5330': {
    selector: 470401360549526817n,
    name: 'superseed-mainnet',
    family: 'evm',
  },
  '5611': {
    selector: 13274425992935471758n,
    name: 'binance_smart_chain-testnet-opbnb-1',
    family: 'evm',
  },
  '5668': { selector: 8911150974185440581n, name: 'nexon-dev', family: 'evm' },
  '6342': {
    selector: 2443239559770384419n,
    name: 'megaeth-testnet',
    family: 'evm',
  },
  '6343': {
    selector: 18241817625092392675n,
    name: 'megaeth-testnet-2',
    family: 'evm',
  },
  '6398': {
    selector: 379340054879810246n,
    name: 'everclear-testnet-sepolia',
    family: 'evm',
  },
  '6900': {
    selector: 17349189558768828726n,
    name: 'nibiru-mainnet',
    family: 'evm',
  },
  '6930': {
    selector: 305104239123120457n,
    name: 'nibiru-testnet',
    family: 'evm',
  },
  '7000': {
    selector: 10817664450262215148n,
    name: 'zetachain-mainnet',
    family: 'evm',
  },
  '8217': {
    selector: 9813823125703490621n,
    name: 'kaia-mainnet',
    family: 'evm',
  },
  '8453': {
    selector: 15971525489660198786n,
    name: 'ethereum-mainnet-base-1',
    family: 'evm',
  },
  '9000': {
    selector: 344208382356656551n,
    name: 'ondo-testnet',
    family: 'evm',
  },
  '9559': {
    selector: 1113014352258747600n,
    name: 'neonlink-testnet',
    family: 'evm',
  },
  '9745': {
    selector: 9335212494177455608n,
    name: 'plasma-mainnet',
    family: 'evm',
  },
  '9746': {
    selector: 3967220077692964309n,
    name: 'plasma-testnet',
    family: 'evm',
  },
  '10087': {
    selector: 3667207123485082040n,
    name: 'gate-layer-testnet',
    family: 'evm',
  },
  '10088': {
    selector: 9373518659714509671n,
    name: 'gate-layer-mainnet',
    family: 'evm',
  },
  '10143': {
    selector: 2183018362218727504n,
    name: 'monad-testnet',
    family: 'evm',
  },
  '10200': {
    selector: 8871595565390010547n,
    name: 'gnosis_chain-testnet-chiado',
    family: 'evm',
  },
  '11124': {
    selector: 16235373811196386733n,
    name: 'abstract-testnet',
    family: 'evm',
  },
  '12324': {
    selector: 3162193654116181371n,
    name: 'ethereum-mainnet-arbitrum-1-l3x-1',
    family: 'evm',
  },
  '12325': {
    selector: 3486622437121596122n,
    name: 'ethereum-testnet-sepolia-arbitrum-1-l3x-1',
    family: 'evm',
  },
  '13371': {
    selector: 1237925231416731909n,
    name: 'ethereum-mainnet-immutable-zkevm-1',
    family: 'evm',
  },
  '13473': {
    selector: 4526165231216331901n,
    name: 'ethereum-testnet-sepolia-immutable-zkevm-1',
    family: 'evm',
  },
  '14601': {
    selector: 1763698235108410440n,
    name: 'sonic-testnet',
    family: 'evm',
  },
  '16600': {
    selector: 16088006396410204581n,
    name: '0g-testnet-newton',
    family: 'evm',
  },
  '16601': {
    selector: 2131427466778448014n,
    name: '0g-testnet-galileo',
    family: 'evm',
  },
  '16602': {
    selector: 6892437333620424805n,
    name: '0g-testnet-galileo-1',
    family: 'evm',
  },
  '16661': { selector: 4426351306075016396n, name: '0g-mainnet', family: 'evm' },
  '17000': {
    selector: 7717148896336251131n,
    name: 'ethereum-testnet-holesky',
    family: 'evm',
  },
  '25327': {
    selector: 9723842205701363942n,
    name: 'everclear-mainnet',
    family: 'evm',
  },
  '26888': { selector: 7051849327615092843n, name: 'ab-testnet', family: 'evm' },
  '31337': {
    selector: 7759470850252068959n,
    name: 'anvil-devnet',
    family: 'evm',
  },
  '33111': {
    selector: 9900119385908781505n,
    name: 'apechain-testnet-curtis',
    family: 'evm',
  },
  '33139': {
    selector: 14894068710063348487n,
    name: 'apechain-mainnet',
    family: 'evm',
  },
  '34443': {
    selector: 7264351850409363825n,
    name: 'ethereum-mainnet-mode-1',
    family: 'evm',
  },
  '36888': { selector: 4829375610284793157n, name: 'ab-mainnet', family: 'evm' },
  '36900': {
    selector: 4059281736450291836n,
    name: 'adi-mainnet',
    family: 'evm',
  },
  '37111': {
    selector: 6827576821754315911n,
    name: 'ethereum-testnet-sepolia-lens-1',
    family: 'evm',
  },
  '42161': {
    selector: 4949039107694359620n,
    name: 'ethereum-mainnet-arbitrum-1',
    family: 'evm',
  },
  '42220': {
    selector: 1346049177634351622n,
    name: 'celo-mainnet',
    family: 'evm',
  },
  '42429': {
    selector: 3963528237232804922n,
    name: 'tempo-testnet',
    family: 'evm',
  },
  '42793': {
    selector: 13624601974233774587n,
    name: 'etherlink-mainnet',
    family: 'evm',
  },
  '43111': {
    selector: 1804312132722180201n,
    name: 'hemi-mainnet',
    family: 'evm',
  },
  '43113': {
    selector: 14767482510784806043n,
    name: 'avalanche-testnet-fuji',
    family: 'evm',
  },
  '43114': {
    selector: 6433500567565415381n,
    name: 'avalanche-mainnet',
    family: 'evm',
  },
  '44787': {
    selector: 3552045678561919002n,
    name: 'celo-testnet-alfajores',
    family: 'evm',
  },
  '45439': {
    selector: 8446413392851542429n,
    name: 'private-testnet-opala',
    family: 'evm',
  },
  '47763': {
    selector: 7222032299962346917n,
    name: 'neox-mainnet',
    family: 'evm',
  },
  '48898': {
    selector: 13781831279385219069n,
    name: 'zircuit-testnet-garfield',
    family: 'evm',
  },
  '48899': {
    selector: 4562743618362911021n,
    name: 'ethereum-testnet-sepolia-zircuit-1',
    family: 'evm',
  },
  '48900': {
    selector: 17198166215261833993n,
    name: 'ethereum-mainnet-zircuit-1',
    family: 'evm',
  },
  '51888': {
    selector: 6473245816409426016n,
    name: 'memento-mainnet',
    family: 'evm',
  },
  '53302': {
    selector: 13694007683517087973n,
    name: 'superseed-testnet',
    family: 'evm',
  },
  '57054': {
    selector: 3676871237479449268n,
    name: 'sonic-testnet-blaze',
    family: 'evm',
  },
  '57073': {
    selector: 3461204551265785888n,
    name: 'ethereum-mainnet-ink-1',
    family: 'evm',
  },
  '59140': {
    selector: 1355246678561316402n,
    name: 'ethereum-testnet-goerli-linea-1',
    family: 'evm',
  },
  '59141': {
    selector: 5719461335882077547n,
    name: 'ethereum-testnet-sepolia-linea-1',
    family: 'evm',
  },
  '59144': {
    selector: 4627098889531055414n,
    name: 'ethereum-mainnet-linea-1',
    family: 'evm',
  },
  '59902': {
    selector: 3777822886988675105n,
    name: 'ethereum-testnet-sepolia-metis-1',
    family: 'evm',
  },
  '60118': {
    selector: 15758750456714168963n,
    name: 'nexon-mainnet-lith',
    family: 'evm',
  },
  '60808': {
    selector: 3849287863852499584n,
    name: 'bitcoin-mainnet-bob-1',
    family: 'evm',
  },
  '61166': {
    selector: 5214452172935136222n,
    name: 'treasure-mainnet',
    family: 'evm',
  },
  '68414': {
    selector: 12657445206920369324n,
    name: 'nexon-mainnet-henesys',
    family: 'evm',
  },
  '76578': { selector: 781901677223027175n, family: 'evm' },
  '80001': {
    selector: 12532609583862916517n,
    name: 'polygon-testnet-mumbai',
    family: 'evm',
  },
  '80002': {
    selector: 16281711391670634445n,
    name: 'polygon-testnet-amoy',
    family: 'evm',
  },
  '80069': {
    selector: 7728255861635209484n,
    name: 'berachain-testnet-bepolia',
    family: 'evm',
  },
  '80084': {
    selector: 8999465244383784164n,
    name: 'berachain-testnet-bartio',
    family: 'evm',
  },
  '80085': {
    selector: 12336603543561911511n,
    name: 'berachain-testnet-artio',
    family: 'evm',
  },
  '80087': {
    selector: 2285225387454015855n,
    name: 'zero-g-testnet-galileo',
    family: 'evm',
  },
  '80094': {
    selector: 1294465214383781161n,
    name: 'berachain-mainnet',
    family: 'evm',
  },
  '81224': {
    selector: 9478124434908827753n,
    name: 'codex-mainnet',
    family: 'evm',
  },
  '81457': {
    selector: 4411394078118774322n,
    name: 'ethereum-mainnet-blast-1',
    family: 'evm',
  },
  '84531': {
    selector: 5790810961207155433n,
    name: 'ethereum-testnet-goerli-base-1',
    family: 'evm',
  },
  '84532': {
    selector: 10344971235874465080n,
    name: 'ethereum-testnet-sepolia-base-1',
    family: 'evm',
  },
  '98864': {
    selector: 3743020999916460931n,
    name: 'plume-devnet',
    family: 'evm',
  },
  '98865': { selector: 3208172210661564830n, family: 'evm' },
  '98866': {
    selector: 17912061998839310979n,
    name: 'plume-mainnet',
    family: 'evm',
  },
  '98867': {
    selector: 13874588925447303949n,
    name: 'plume-testnet-sepolia',
    family: 'evm',
  },
  '99999': {
    selector: 9418205736192840573n,
    name: 'adi-testnet',
    family: 'evm',
  },
  '128123': {
    selector: 1910019406958449359n,
    name: 'etherlink-testnet',
    family: 'evm',
  },
  '129399': {
    selector: 9090863410735740267n,
    name: 'polygon-testnet-tatara',
    family: 'evm',
  },
  '167000': {
    selector: 16468599424800719238n,
    name: 'ethereum-mainnet-taiko-1',
    family: 'evm',
  },
  '167009': {
    selector: 7248756420937879088n,
    name: 'ethereum-testnet-holesky-taiko-1',
    family: 'evm',
  },
  '167012': {
    selector: 9873759436596923887n,
    name: 'ethereum-testnet-hoodi-taiko',
    family: 'evm',
  },
  '167013': {
    selector: 15858691699034549072n,
    name: 'ethereum-testnet-hoodi-taiko-1',
    family: 'evm',
  },
  '192940': {
    selector: 7189150270347329685n,
    name: 'mind-testnet',
    family: 'evm',
  },
  '200810': {
    selector: 3789623672476206327n,
    name: 'bitcoin-testnet-bitlayer-1',
    family: 'evm',
  },
  '200901': {
    selector: 7937294810946806131n,
    name: 'bitcoin-mainnet-bitlayer-1',
    family: 'evm',
  },
  '421613': {
    selector: 6101244977088475029n,
    name: 'ethereum-testnet-goerli-arbitrum-1',
    family: 'evm',
  },
  '421614': {
    selector: 3478487238524512106n,
    name: 'ethereum-testnet-sepolia-arbitrum-1',
    family: 'evm',
  },
  '424242': {
    selector: 4489326297382772450n,
    name: 'private-testnet-mica',
    family: 'evm',
  },
  '432201': {
    selector: 1458281248224512906n,
    name: 'avalanche-subnet-dexalot-testnet',
    family: 'evm',
  },
  '432204': {
    selector: 5463201557265485081n,
    name: 'avalanche-subnet-dexalot-mainnet',
    family: 'evm',
  },
  '534351': {
    selector: 2279865765895943307n,
    name: 'ethereum-testnet-sepolia-scroll-1',
    family: 'evm',
  },
  '534352': {
    selector: 13204309965629103672n,
    name: 'ethereum-mainnet-scroll-1',
    family: 'evm',
  },
  '560048': {
    selector: 10380998176179737091n,
    name: 'ethereum-testnet-hoodi',
    family: 'evm',
  },
  '595581': {
    selector: 7837562506228496256n,
    name: 'avalanche-testnet-nexon',
    family: 'evm',
  },
  '686868': {
    selector: 5269261765892944301n,
    name: 'bitcoin-testnet-merlin',
    family: 'evm',
  },
  '688688': {
    selector: 4012524741200567430n,
    name: 'pharos-testnet',
    family: 'evm',
  },
  '688689': {
    selector: 16098325658947243212n,
    name: 'pharos-atlantic-testnet',
    family: 'evm',
  },
  '717160': {
    selector: 4418231248214522936n,
    name: 'ethereum-testnet-sepolia-polygon-validium-1',
    family: 'evm',
  },
  '743111': {
    selector: 16126893759944359622n,
    name: 'hemi-testnet-sepolia',
    family: 'evm',
  },
  '747474': {
    selector: 2459028469735686113n,
    name: 'polygon-mainnet-katana',
    family: 'evm',
  },
  '763373': {
    selector: 9763904284804119144n,
    name: 'ink-testnet-sepolia',
    family: 'evm',
  },
  '807424': { selector: 14632960069656270105n, name: 'nexon-qa', family: 'evm' },
  '808813': {
    selector: 5535534526963509396n,
    name: 'bitcoin-testnet-sepolia-bob-1',
    family: 'evm',
  },
  '810180': {
    selector: 4350319965322101699n,
    name: 'zklink_nova-mainnet',
    family: 'evm',
  },
  '810181': {
    selector: 5837261596322416298n,
    name: 'zklink_nova-testnet',
    family: 'evm',
  },
  '812242': {
    selector: 7225665875429174318n,
    name: 'codex-testnet',
    family: 'evm',
  },
  '847799': {
    selector: 5556806327594153475n,
    name: 'nexon-stage',
    family: 'evm',
  },
  '978657': {
    selector: 10443705513486043421n,
    name: 'ethereum-testnet-sepolia-arbitrum-1-treasure-1',
    family: 'evm',
  },
  '978658': {
    selector: 3676916124122457866n,
    name: 'treasure-testnet-topaz',
    family: 'evm',
  },
  '978670': {
    selector: 1010349088906777999n,
    name: 'ethereum-mainnet-arbitrum-1-treasure-1',
    family: 'evm',
  },
  '2019775': {
    selector: 945045181441419236n,
    name: 'jovay-testnet',
    family: 'evm',
  },
  '5042002': {
    selector: 3034092155422581607n,
    name: 'arc-testnet',
    family: 'evm',
  },
  '5734951': {
    selector: 1523760397290643893n,
    name: 'jovay-mainnet',
    family: 'evm',
  },
  '7777777': {
    selector: 3555797439612589184n,
    name: 'zora-mainnet',
    family: 'evm',
  },
  '11142220': {
    selector: 3761762704474186180n,
    name: 'celo-sepolia',
    family: 'evm',
  },
  '11155111': {
    selector: 16015286601757825753n,
    name: 'ethereum-testnet-sepolia',
    family: 'evm',
  },
  '11155420': {
    selector: 5224473277236331295n,
    name: 'ethereum-testnet-sepolia-optimism-1',
    family: 'evm',
  },
  '12227332': {
    selector: 2217764097022649312n,
    name: 'neox-testnet-t4',
    family: 'evm',
  },
  '21000000': {
    selector: 9043146809313071210n,
    name: 'corn-mainnet',
    family: 'evm',
  },
  '21000001': {
    selector: 1467427327723633929n,
    name: 'ethereum-testnet-sepolia-corn-1',
    family: 'evm',
  },
  '31415926': {
    selector: 7060342227814389000n,
    name: 'filecoin-testnet',
    family: 'evm',
  },
  '161221135': {
    selector: 14684575664602284776n,
    name: 'plume-testnet',
    family: 'evm',
  },
  '168587773': {
    selector: 2027362563942762617n,
    name: 'ethereum-testnet-sepolia-blast-1',
    family: 'evm',
  },
  '728126428': {
    selector: 1546563616611573946n,
    name: 'tron-mainnet-evm',
    family: 'evm',
  },
  '999999999': {
    selector: 16244020411108056671n,
    name: 'zora-testnet',
    family: 'evm',
  },
  '2494104990': {
    selector: 13231703482326770598n,
    name: 'tron-testnet-shasta-evm',
    family: 'evm',
  },
  '3360022319': {
    selector: 13231703482326770600n,
    name: 'tron-devnet-evm',
    family: 'evm',
  },
  '3448148188': {
    selector: 2052925811360307749n,
    name: 'tron-testnet-nile-evm',
    family: 'evm',
  },
  // end:generate

  // generate:
  // fetch('https://github.com/smartcontractkit/chain-selectors/raw/main/selectors_solana.yml')
  //   .then((res) => res.text())
  //   .then((body) => require('yaml').parse(body, { intAsBigInt: true }).selectors)
  //   .then((obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { ...v, family: 'solana' }])))
  //   .then((obj) => [...require('util').inspect(obj).split('\n').slice(1, -1), ','])
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': {
    name: 'solana-mainnet',
    selector: 124615329519749607n,
    family: 'solana',
  },
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': {
    name: 'solana-testnet',
    selector: 6302590918974934319n,
    family: 'solana',
  },
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: {
    name: 'solana-devnet',
    selector: 16423721717087811551n,
    family: 'solana',
  },
  // end:generate

  // generate:
  // fetch('https://github.com/smartcontractkit/chain-selectors/raw/main/selectors_aptos.yml')
  //   .then((res) => res.text())
  //   .then((body) => require('yaml').parse(body, { intAsBigInt: true }).selectors)
  //   .then((obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [`aptos:${k}`, { ...v, family: 'aptos' }])))
  //   .then((obj) => [...require('util').inspect(obj).split('\n').slice(1, -1), ','])
  'aptos:1': {
    name: 'aptos-mainnet',
    selector: 4741433654826277614n,
    family: 'aptos',
  },
  'aptos:2': {
    name: 'aptos-testnet',
    selector: 743186221051783445n,
    family: 'aptos',
  },
  'aptos:4': {
    name: 'aptos-localnet',
    selector: 4457093679053095497n,
    family: 'aptos',
  },
  // end:generate

  // generate:
  // fetch('https://github.com/smartcontractkit/chain-selectors/raw/main/selectors_sui.yml')
  //   .then((res) => res.text())
  //   .then((body) => require('yaml').parse(body, { intAsBigInt: true }).selectors)
  //   .then((obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [`sui:${k}`, { ...v, family: 'sui' }])))
  //   .then((obj) => [...require('util').inspect(obj).split('\n').slice(1, -1), ','])
  'sui:1': {
    name: 'sui-mainnet',
    selector: 17529533435026248318n,
    family: 'sui',
  },
  'sui:2': {
    name: 'sui-testnet',
    selector: 9762610643973837292n,
    family: 'sui',
  },
  'sui:4': {
    name: 'sui-localnet',
    selector: 18395503381733958356n,
    family: 'sui',
  },
  // end:generate

  // generate:
  // fetch('https://github.com/smartcontractkit/chain-selectors/raw/main/selectors_ton.yml')
  //   .then((res) => res.text())
  //   .then((body) => require('yaml').parse(body, { intAsBigInt: true }).selectors)
  //   .then((obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { ...v, family: 'ton' }])))
  //   .then((obj) => [...require('util').inspect(obj).split('\n').slice(1, -1), ','])
  '-239': {
    name: 'ton-mainnet',
    selector: 16448340667252469081n,
    family: 'ton',
  },
  '-3': {
    name: 'ton-testnet',
    selector: 1399300952838017768n,
    family: 'ton',
  },
  '-217': {
    name: 'ton-localnet',
    selector: 13879075125137744094n,
    family: 'ton',
  },
  // end:generate
}

export default selectors
