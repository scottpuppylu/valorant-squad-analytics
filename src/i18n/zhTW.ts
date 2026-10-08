import type { PlayerRole, ScoreCategory } from '../types/valorant.js';

export const zhTW = {
  brand: {
    name: '哥布林大調查',
    subtitle: '社群透明指標',
    demo: '虛構示範資料',
  },
  navigation: {
    dashboard: '首頁',
    leaderboard: '戰力排名',
    players: '玩家',
    compare: '比較',
    maps: '地圖分析',
    agents: '特務／角色分析',
    weapons: '武器分析',
    matches: '對戰',
    connect: '加入調查',
    dictionary: '數據字典',
    about: '關於本站',
    privacy: '隱私說明',
  },
  scores: {
    overall: '綜合表現',
    firepower: '火力',
    roundImpact: '回合影響', economy: '經濟效率', roleValue: '角色價值',
    entry: '開戰影響',
    teamplay: '團隊貢獻',
    clutch: '殘局能力',
    consistency: '穩定度',
    confidence: '樣本信心',
  } satisfies Record<ScoreCategory | 'confidence', string>,
  /** agent-catalog-v1: label when no played agent has a known role (never a guessed role). */
  unknownRole: '未知角色',
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
  { to: '/players', label: zhTW.navigation.players },
  { to: '/compare', label: zhTW.navigation.compare },
  { to: '/synergy', label: '搭檔分析' },
  { to: '/matches', label: zhTW.navigation.matches },
] as const;

export const secondaryNavigation = [
  { to: '/maps', label: zhTW.navigation.maps },
  { to: '/agents', label: zhTW.navigation.agents },
  { to: '/weapons', label: zhTW.navigation.weapons },
  { to: '/dictionary', label: zhTW.navigation.dictionary },
  { to: '/connect', label: zhTW.navigation.connect },
  { to: '/about', label: zhTW.navigation.about },
  { to: '/privacy', label: zhTW.navigation.privacy },
] as const;

export const scoreMetricIds = {
  overall: 'overall',
  firepower: 'firepower',
  roundImpact: 'round-impact', economy: 'economy', roleValue: 'role-value',
  entry: 'entry',
  teamplay: 'teamplay',
  clutch: 'clutch-score',
  consistency: 'consistency',
  confidence: 'confidence',
} as const;
