import type { PlayerRole, ScoreCategory } from '../types/valorant';

export const zhTW = {
  brand: {
    name: '小隊分析',
    subtitle: '社群透明指標',
    demo: '示範資料',
  },
  navigation: {
    dashboard: '總覽',
    leaderboard: '戰力排名',
    players: '玩家分析',
    maps: '地圖分析',
    matches: '對戰紀錄',
    compare: '玩家比較',
    agents: '特務／角色分析',
    synergy: '隊友搭配',
    import: '資料匯入',
    scoring: '評分設定',
    dictionary: '數據字典',
    about: '關於本站',
    privacy: '隱私說明',
    connectRiot: '連結 Riot',
  },
  scores: {
    overall: '綜合表現',
    firepower: '火力',
    entry: '開戰影響',
    teamplay: '團隊貢獻',
    clutch: '殘局能力',
    consistency: '穩定度',
    confidence: '樣本信心',
  } satisfies Record<ScoreCategory | 'confidence', string>,
  roles: {
    Duelist: '決鬥者',
    Initiator: '先鋒',
    Controller: '控場者',
    Sentinel: '守衛',
  } satisfies Record<PlayerRole, string>,
  common: {
    loadingChart: '圖表載入中…',
    viewDefinition: '查看指標定義',
    unavailable: '尚未提供',
    backToLeaderboard: '返回戰力排名',
    fictionalData: '虛構示範資料',
  },
} as const;

export const primaryNavigation = [
  { to: '/', label: zhTW.navigation.dashboard },
  { to: '/leaderboard', label: zhTW.navigation.leaderboard },
  { to: '/players/nova-hex', label: zhTW.navigation.players },
  { to: '/dictionary', label: zhTW.navigation.dictionary },
  { to: '/matches', label: zhTW.navigation.matches },
] as const;

export const secondaryNavigation = [
  { to: '/compare', label: zhTW.navigation.compare },
  { to: '/maps', label: zhTW.navigation.maps },
  { to: '/agents', label: zhTW.navigation.agents },
  { to: '/synergy', label: zhTW.navigation.synergy },
  { to: '/import', label: zhTW.navigation.import },
  { to: '/scoring', label: zhTW.navigation.scoring },
  { to: '/about', label: zhTW.navigation.about },
  { to: '/privacy', label: zhTW.navigation.privacy },
  { to: '/connect-riot', label: zhTW.navigation.connectRiot },
] as const;

export const scoreMetricIds = {
  overall: 'overall',
  firepower: 'firepower',
  entry: 'entry',
  teamplay: 'teamplay',
  clutch: 'clutch-score',
  consistency: 'consistency',
  confidence: 'confidence',
} as const;
