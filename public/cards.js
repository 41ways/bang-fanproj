/**
 * 뱅! — 카드 · 인물 · 역할 정의. 서버(규칙)와 화면이 같이 쓴다.
 *
 * 카드 80장의 무늬·숫자는 원판 기본판 그대로다. "뽑기!"(술통 · 감옥 · 다이너마이트)가
 * 무늬와 숫자로 판가름 나서, 장수만 맞추면 확률이 달라진다.
 */

/* 무늬: S 스페이드 · H 하트 · D 다이아 · C 클럽 */
export const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/**
 * 카드 종류.
 *  blue   true 면 앞에 내려놓고 계속 효과가 나는 카드(파란 테두리)
 *  range  무기 사거리
 *  tg     대상: 'reach'(사거리 안) · 'one'(거리 1) · 'any'(아무나) · 'jail'(보안관 말고 아무나)
 */
export const KINDS = {
  bang:         { name: '뱅!',        tg: 'reach', desc: '사거리 안의 한 명을 쏜다. 상대는 빗나감!을 내지 못하면 생명 1을 잃는다. 한 턴에 한 장만.' },
  missed:       { name: '빗나감!',    desc: '나를 향한 뱅!을 하나 막는다. 남의 턴에만 낸다.' },
  beer:         { name: '맥주',       desc: '생명 1을 되찾는다. 마지막 생명을 잃는 순간에도 내서 살아날 수 있다. 두 명만 남으면 효과가 없다.' },
  saloon:       { name: '주점',       desc: '살아 있는 모두가 생명 1을 되찾는다.' },
  stagecoach:   { name: '역마차',     desc: '카드 2장을 뽑는다.' },
  wellsfargo:   { name: '웰스 파고',  desc: '카드 3장을 뽑는다.' },
  generalstore: { name: '잡화점',     desc: '살아 있는 사람 수만큼 카드를 펼친다. 나부터 돌아가며 한 장씩 가져간다.' },
  panic:        { name: '강탈!',      tg: 'one',   desc: '거리 1 안의 한 명에게서 카드 한 장을 빼앗는다(손에서 무작위로, 또는 앞에 놓인 카드).' },
  catbalou:     { name: '캣 벌로우',  tg: 'any',   desc: '아무나 한 명의 카드 한 장을 버리게 한다(손에서 무작위로, 또는 앞에 놓인 카드).' },
  gatling:      { name: '기관총',     desc: '다른 모두에게 뱅!. 뱅! 한 장 제한에 들지 않는다.' },
  indians:      { name: '인디언!',    desc: '다른 모두는 뱅!을 한 장 버리거나 생명 1을 잃는다.' },
  duel:         { name: '결투',       tg: 'any',   desc: '아무나 한 명과 결투. 상대부터 번갈아 뱅!을 버리고, 먼저 못 버리는 쪽이 생명 1을 잃는다.' },
  barrel:       { name: '술통',       blue: true,  desc: '뱅!을 맞을 때 "뽑기!" — 하트가 나오면 빗나감!으로 친다.' },
  scope:        { name: '조준경',     blue: true,  desc: '내가 남을 볼 때 거리가 1 줄어든다.' },
  mustang:      { name: '야생마',     blue: true,  desc: '남이 나를 볼 때 거리가 1 늘어난다.' },
  jail:         { name: '감옥',       blue: true, tg: 'jail', desc: '보안관이 아닌 한 명 앞에 놓는다. 그 사람은 턴 시작에 "뽑기!" — 하트면 풀려나 턴을 하고, 아니면 턴을 거른다.' },
  dynamite:     { name: '다이너마이트', blue: true, desc: '내 앞에 놓는다. 턴 시작에 "뽑기!" — 스페이드 2~9면 터져 생명 3을 잃고, 아니면 왼쪽 사람에게 넘어간다.' },
  volcanic:     { name: '볼캐닉',     blue: true, range: 1, desc: '무기 · 사거리 1. 한 턴에 뱅!을 몇 장이든 쏠 수 있다.' },
  schofield:    { name: '스코필드',   blue: true, range: 2, desc: '무기 · 사거리 2.' },
  remington:    { name: '레밍턴',     blue: true, range: 3, desc: '무기 · 사거리 3.' },
  carabine:     { name: '카빈',       blue: true, range: 4, desc: '무기 · 사거리 4.' },
  winchester:   { name: '윈체스터',   blue: true, range: 5, desc: '무기 · 사거리 5.' },
};
export const WEAPONS = ['volcanic', 'schofield', 'remington', 'carabine', 'winchester'];

/* 덱 80장: [종류, 무늬·숫자 …] — 숫자는 RANKS 의 표기 */
const DECK_SPEC = [
  ['bang', 'SA', 'HQ', 'HK', 'HA', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'DJ', 'DQ', 'DK', 'DA',
    'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'],
  ['missed', 'C10', 'CJ', 'CQ', 'CK', 'CA', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'],
  ['beer', 'H6', 'H7', 'H8', 'H9', 'H10', 'HJ'],
  ['saloon', 'H5'],
  ['stagecoach', 'S9', 'S9'],
  ['wellsfargo', 'H3'],
  ['generalstore', 'C9', 'SQ'],
  ['panic', 'HJ', 'HQ', 'HA', 'D8'],
  ['catbalou', 'HK', 'D9', 'D10', 'DJ'],
  ['gatling', 'H10'],
  ['indians', 'DK', 'DA'],
  ['duel', 'DQ', 'SJ', 'C8'],
  ['barrel', 'SQ', 'SK'],
  ['scope', 'SA'],
  ['mustang', 'H8', 'H9'],
  ['jail', 'SJ', 'S10', 'H4'],
  ['dynamite', 'H2'],
  ['volcanic', 'S10', 'C10'],
  ['schofield', 'CJ', 'CQ', 'SK'],
  ['remington', 'CK'],
  ['carabine', 'CA'],
  ['winchester', 'S8'],
];

/** 카드 80장. id 는 0..79 — 판마다 같다 */
export const DECK = [];
for (const [k, ...cs] of DECK_SPEC) {
  for (const c of cs) DECK.push({ id: DECK.length, k, s: c[0], r: RANKS.indexOf(c.slice(1)) });
}

/** 인물 16명. hp 는 기본 생명(보안관은 +1) */
export const CHARS = {
  bart:        { name: '바트 캐시디',   hp: 4, desc: '생명을 1 잃을 때마다 카드를 1장 뽑는다.' },
  blackjack:   { name: '블랙 잭',       hp: 4, desc: '카드를 뽑을 때 두 번째 장을 모두에게 보여 준다. 하트나 다이아면 1장 더 뽑는다.' },
  calamity:    { name: '캘러미티 자넷', hp: 4, desc: '뱅!을 빗나감!처럼, 빗나감!을 뱅!처럼 쓸 수 있다.' },
  elgringo:    { name: '엘 그링고',     hp: 3, desc: '생명을 1 잃을 때마다 그렇게 만든 사람의 손에서 카드 1장을 무작위로 가져온다.' },
  jesse:       { name: '제시 존스',     hp: 4, desc: '첫 장을 더미 대신 다른 사람의 손에서 무작위로 가져올 수 있다.' },
  jourdonnais: { name: '주르도네',      hp: 4, desc: '언제나 술통을 하나 가진 셈이다.' },
  kit:         { name: '킷 칼슨',       hp: 4, desc: '카드를 뽑을 때 위의 3장을 보고 2장을 고른다. 남은 1장은 더미 위로.' },
  lucky:       { name: '럭키 듀크',     hp: 4, desc: '"뽑기!"를 할 때 2장을 뒤집어 좋은 쪽을 고른다.' },
  paul:        { name: '폴 리그렛',     hp: 3, desc: '언제나 야생마를 하나 가진 셈이다.' },
  pedro:       { name: '페드로 라미레즈', hp: 4, desc: '첫 장을 더미 대신 버린 카드 맨 위에서 가져올 수 있다.' },
  rose:        { name: '로즈 둘란',     hp: 4, desc: '언제나 조준경을 하나 가진 셈이다.' },
  sid:         { name: '시드 케첨',     hp: 4, desc: '언제든 카드 2장을 버리고 생명 1을 되찾을 수 있다.' },
  slab:        { name: '슬랩 더 킬러',  hp: 4, desc: '그가 쏜 뱅!은 빗나감! 2장이 있어야 막을 수 있다.' },
  suzy:        { name: '수지 라파예트', hp: 4, desc: '손에 카드가 하나도 없게 되면 곧바로 1장을 뽑는다.' },
  vulture:     { name: '벌처 샘',       hp: 4, desc: '누가 죽으면 그 사람의 카드를 모두 가져온다.' },
  willy:       { name: '윌리 더 키드',  hp: 4, desc: '한 턴에 뱅!을 몇 장이든 쏠 수 있다.' },
};

export const ROLES = {
  sheriff:  { name: '보안관', goal: '무법자와 배신자를 모두 쓰러뜨린다.' },
  deputy:   { name: '부관',   goal: '보안관을 지키며 무법자와 배신자를 모두 쓰러뜨린다.' },
  outlaw:   { name: '무법자', goal: '보안관을 쓰러뜨린다.' },
  renegade: { name: '배신자', goal: '혼자 살아남는다 — 보안관은 맨 마지막에.' },
};

/** 인원별 역할 */
export const ROLES_BY_N = {
  4: ['sheriff', 'renegade', 'outlaw', 'outlaw'],
  5: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'deputy'],
  6: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'outlaw', 'deputy'],
  7: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'outlaw', 'deputy', 'deputy'],
};

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 7;

export const cardName = c => (KINDS[c.k] ? KINDS[c.k].name : '?');
export const cardTag = c => SUITS[c.s] + RANKS[c.r];
