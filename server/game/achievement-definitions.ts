// Issue #88 / User Request: canonical 16 achievements copied from official SimCompanies HAR capture.
// Defines achievement tiers, rewards, images, criteria targets, and compatibility metadata.

export interface IndividualAchievement {
  id: string;
  name: string;
  congratulation: string;
  is_daily: boolean;
  is_level: boolean;
  level: number;
  done: number;
  available: number;
  sim_boosts: number;
  reward: number;
  message: string;
  /** Live gameplay progress toward the criteria target. */
  progress: number;
  /** Gameplay stat value required before the reward can be claimed. */
  target: number;
  nextAchievement: {
    name: string;
    done: number;
    available: number;
    message: string;
    reward: number;
    sim_boosts: number;
  } | null;
}

export type AchievementStatKey =
  | 'marketTrades'
  | 'marketSold'
  | 'productionBatches'
  | 'retailSales'
  | 'upgradedBuildings'
  | 'totalBuildingSize'
  | 'executiveTrainings'
  | 'executivesCount'
  | 'maxResearchQuality'
  | 'researchedQ1Count'
  | 'governmentOrdersCompleted'
  | 'companyLevel'
  | 'prospectorCount'
  | 'todayActivity'
  | 'overachieverRank';

export interface CanonicalAchievementDef {
  id: string;
  aliases: string[];
  label: string;
  type: string | null;
  starsMax: number;
  rewards?: number[];
  reward?: number;
  simBoosts: number;
  image: string | null;
  action: string;
  statKey: AchievementStatKey;
  target: number;
  congratulation: string;
  message: string;
}

/**
 * 16 Canonical Achievements exactly as structured in SimCompanies official HAR capture:
 * - Order matches official GET /api/v2/companies/me/achievements/ response
 * - Reward amounts, starsMax, type keys, and image assets preserved
 */
export const CANONICAL_ACHIEVEMENTS: CanonicalAchievementDef[] = [
  {
    id: 'daily-production',
    aliases: ['Daily', 'daily', 'daily-retail'],
    label: '每日生产零售',
    type: null,
    starsMax: 1,
    simBoosts: 5,
    image: null,
    action: '开始生产或零售',
    statKey: 'todayActivity',
    target: 1,
    congratulation: '恭喜达成每日生产零售成就！',
    message: '每日启动生产或零售即可领取奖励。'
  },
  {
    id: 'first-steps',
    aliases: ['Tutorial', 'tutorial', 'tutorial-finished'],
    label: '完成教程',
    type: 'Tutorial',
    starsMax: 1,
    rewards: [12000],
    reward: 12000,
    simBoosts: 5,
    image: 'images/achievements/Tutorial Finished.png',
    action: '完成新手教程并生产第一批商品',
    statKey: 'productionBatches',
    target: 1,
    congratulation: '初涉商海，迈出成功第一步！',
    message: '在产业地图上兴建并运营你的第一座工厂。'
  },
  {
    id: 'builder',
    aliases: ['Builder'],
    label: '施工商',
    type: 'Builder',
    starsMax: 2,
    rewards: [4500, 7500],
    reward: 7500,
    simBoosts: 5,
    image: 'images/achievements/Builder.png',
    action: '升级产业建筑规模',
    statKey: 'upgradedBuildings',
    target: 1,
    congratulation: '建筑大师，产业规模进一步扩张！',
    message: '升级建筑以扩大产能和员工规模。'
  },
  {
    id: 'employer-of-the-year',
    aliases: ['Employer', 'employer'],
    label: '雇主',
    type: 'Employer',
    starsMax: 4,
    rewards: [4000, 6000, 10000, 20000],
    reward: 20000,
    simBoosts: 5,
    image: null,
    action: '招聘并培训管理团队，提升公司运营效益',
    statKey: 'executiveTrainings',
    target: 1,
    congratulation: '卓越雇主，高管团队高效运转！',
    message: '管理并培训高管团队。'
  },
  {
    id: 'retail-seller',
    aliases: ['RetailSeller', 'retail'],
    label: '零售商',
    type: 'RetailSeller',
    starsMax: 5,
    rewards: [50, 250, 500, 5000, 50000],
    reward: 50000,
    simBoosts: 5,
    image: null,
    action: '在零售店完成销售并向消费者交付商品',
    statKey: 'retailSales',
    target: 1,
    congratulation: '商业奇才，零售帝国初现雏形！',
    message: '通过零售建筑销售商品以提升零售声誉。'
  },
  {
    id: 'market-seller',
    aliases: ['MarketSeller', 'supplier', 'Supplier'],
    label: '供应商',
    type: 'MarketSeller',
    starsMax: 5,
    rewards: [100, 1000, 5000, 20000, 25000],
    reward: 25000,
    simBoosts: 5,
    image: 'images/achievements/Supplier.png',
    action: '在交易所成功售出商品订单',
    statKey: 'marketSold',
    target: 1,
    congratulation: '优质供应，成为市场上不可或缺的货源！',
    message: '在商品交易所挂单并全部售出。'
  },
  {
    id: 'market-tycoon',
    aliases: ['MarketBuyer', 'market-buyer'],
    label: '收购商',
    type: 'MarketBuyer',
    starsMax: 4,
    rewards: [500, 1000, 5000, 20000],
    reward: 5000,
    simBoosts: 5,
    image: null,
    action: '在交易所买入并达成大宗商品采购',
    statKey: 'marketTrades',
    target: 1,
    congratulation: '恭喜达成市场收购商成就！',
    message: '在交易所买卖并达成大宗商品交易。'
  },
  {
    id: 'startup',
    aliases: ['StartUp', 'start-up'],
    label: '创业者',
    type: 'StartUp',
    starsMax: 4,
    rewards: [5000, 20000, 50000, 100000],
    reward: 100000,
    simBoosts: 5,
    image: 'images/achievements/Start-up.png',
    action: '提升公司综合实力与运营等级',
    statKey: 'companyLevel',
    target: 20,
    congratulation: '白手起家，年轻的企业正在蓬勃发展！',
    message: '持续经营公司并达到更高等级。'
  },
  {
    id: 'scientist',
    aliases: ['Scientist'],
    label: '科学家',
    type: 'Scientist',
    starsMax: 12,
    rewards: [
      8000, 40000, 450000, 1500000, 4000000, 8000000,
      8000000, 3000000, 3000000, 3000000, 3000000, 3000000
    ],
    reward: 8000,
    simBoosts: 5,
    image: null,
    action: '研究专利，使任意产品达到更高品质',
    statKey: 'maxResearchQuality',
    target: 1,
    congratulation: '科技创新，核心技术领跑全行业！',
    message: '投入研发以提升产品品质星级。'
  },
  {
    id: 'architect',
    aliases: ['Architect'],
    label: '建筑师',
    type: 'Architect',
    starsMax: 4,
    rewards: [100000, 250000, 500000, 800000],
    reward: 800000,
    simBoosts: 5,
    image: 'images/achievements/Architect.png',
    action: '建造与扩建产业园区，拓展地块总规模',
    statKey: 'totalBuildingSize',
    target: 10,
    congratulation: '宏伟规划，缔造现代工业奇迹！',
    message: '在产业地图上建设更多建筑以提升总规模。'
  },
  {
    id: 'chairman',
    aliases: ['Chairman'],
    label: '董事长',
    type: 'Chairman',
    starsMax: 4,
    rewards: [12000, 36000, 72000, 96000],
    reward: 96000,
    simBoosts: 5,
    image: null,
    action: '聘任核心管理层高管，完善企业治理结构',
    statKey: 'executivesCount',
    target: 10,
    congratulation: '高瞻远瞩，掌舵现代化跨国集团！',
    message: '组建并委任公司高级管理团队。'
  },
  {
    id: 'mentor',
    aliases: ['Mentor'],
    label: '导师',
    type: 'Mentor',
    starsMax: 4,
    rewards: [20000, 60000, 200000, 500000],
    reward: 500000,
    simBoosts: 5,
    image: null,
    action: '多次深入培训高管人员，全面发掘团队潜能',
    statKey: 'executiveTrainings',
    target: 3,
    congratulation: '循循善诱，培养出行业顶尖管理人才！',
    message: '为高管团队提供多次专业进修课程。'
  },
  {
    id: 'prospector',
    aliases: ['Prospector'],
    label: '勘探专家',
    type: 'Prospector',
    starsMax: 7,
    rewards: [5000, 25000, 50000, 100000, 100000, 100000, 100000],
    reward: 5000,
    simBoosts: 5,
    image: null,
    action: '勘探优质资源丰度并优化矿区布局',
    statKey: 'prospectorCount',
    target: 10,
    congratulation: '慧眼识矿，精准定位最具价值矿脉！',
    message: '勘探并重置低丰度矿井设施。'
  },
  {
    id: 'know-it-all',
    aliases: ['KnowItAll', 'knowitall'],
    label: '万事通',
    type: 'KnowItAll',
    starsMax: 4,
    rewards: [290000, 1200000, 10000000, 40000000],
    reward: 290000,
    simBoosts: 5,
    image: null,
    action: '将所有非季节性产品研究至品质1以上',
    statKey: 'researchedQ1Count',
    target: 30,
    congratulation: '博古通今，涉足全产业链顶尖工艺！',
    message: '全方位研发不同行业的各类产品品质。'
  },
  {
    id: 'bureaucrat',
    aliases: ['Bureaucrat', 'GOBureaucrat'],
    label: '官僚',
    type: 'Bureaucrat',
    starsMax: 4,
    rewards: [20000, 50000, 100000, 200000],
    reward: 50000,
    simBoosts: 5,
    image: null,
    action: '参与国家采购项目，完成政府订单交付',
    statKey: 'governmentOrdersCompleted',
    target: 1,
    congratulation: '政商通达，成为国家信赖的核心战略供应商！',
    message: '成功交付并完成指定政府订单。'
  },
  {
    id: 'overachiever',
    aliases: ['OverAchiever', 'over-achiever'],
    label: '势如破竹',
    type: 'OverAchiever',
    starsMax: 7,
    rewards: [5, 10, 20, 40, 50, 100, 200],
    reward: 0,
    simBoosts: 20,
    image: null,
    action: '跻身全服实力榜单前列',
    statKey: 'overachieverRank',
    target: 1,
    congratulation: '名列前茅，在全服排行榜上傲视群雄！',
    message: '提升公司价值以进入全服前列排名。'
  }
];

/**
 * Claimable achievements catalog — all non-daily canonical achievements can be earned & claimed.
 */
export const ALL_ACHIEVEMENTS: IndividualAchievement[] = CANONICAL_ACHIEVEMENTS
  .filter(def => def.id !== 'daily-production')
  .map((def) => {
    const primaryReward = def.reward ?? (def.rewards && def.rewards.length > 0 ? def.rewards[0] : 5000);
    return {
      id: def.id,
      name: def.label,
      congratulation: def.congratulation,
      is_daily: false,
      is_level: false,
      level: 1,
      done: 0,
      available: 0,
      sim_boosts: def.simBoosts,
      reward: primaryReward,
      message: def.message,
      progress: 0,
      target: def.target,
      nextAchievement: def.starsMax > 1 && def.rewards && def.rewards.length > 1 ? {
        name: `${def.label} II`,
        done: 1,
        available: 0,
        message: `继续提升以达到${def.label}更高星级。`,
        reward: def.rewards[1] ?? primaryReward * 2,
        sim_boosts: def.simBoosts * 2 || 10
      } : null
    };
  });
