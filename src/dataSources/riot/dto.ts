export interface RiotMatchDto {
  matchInfo: RiotMatchInfoDto;
  players: RiotPlayerDto[];
  teams: RiotTeamDto[];
  roundResults: RiotRoundResultDto[];
}

export interface RiotMatchInfoDto {
  matchId: string;
  mapId: string;
  gameStartMillis: number;
  gameLengthMillis: number;
  queueId: string;
  gameMode: string;
  isCompleted: boolean;
  isRanked: boolean;
  seasonId: string;
}

export interface RiotPlayerDto {
  puuid: string;
  gameName: string;
  tagLine: string;
  teamId: string;
  partyId: string;
  characterId: string;
  stats?: RiotPlayerStatsDto;
}

export interface RiotPlayerStatsDto {
  score: number;
  roundsPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  playtimeMillis: number;
  abilityCasts?: {
    grenadeCasts: number;
    ability1Casts: number;
    ability2Casts: number;
    ultimateCasts: number;
  };
}

export interface RiotTeamDto {
  teamId: string;
  won: boolean;
  roundsPlayed: number;
  roundsWon: number;
  numPoints: number;
}

export interface RiotRoundResultDto {
  roundNum: number;
  roundResult: string;
  winningTeam: string;
  winningTeamRole?: string;
  bombPlanter?: string;
  bombDefuser?: string;
  plantRoundTime?: number;
  defuseRoundTime?: number;
  plantSite?: string;
  playerStats: RiotPlayerRoundStatsDto[];
}

export interface RiotPlayerRoundStatsDto {
  puuid: string;
  kills: RiotKillDto[];
  damage: RiotDamageDto[];
  score: number;
  economy: RiotEconomyDto;
}

export interface RiotKillDto {
  timeSinceGameStartMillis: number;
  timeSinceRoundStartMillis: number;
  killer: string;
  victim: string;
  assistants: string[];
  finishingDamage: {
    damageType: string;
    damageItem: string;
    isSecondaryFireMode: boolean;
  };
}

export interface RiotDamageDto {
  receiver: string;
  damage: number;
  legshots: number;
  bodyshots: number;
  headshots: number;
}

export interface RiotEconomyDto {
  loadoutValue: number;
  weapon: string;
  armor: string;
  remaining: number;
  spent: number;
}
