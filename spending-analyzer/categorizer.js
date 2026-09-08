// Keyword-based auto-categorization for transaction descriptions.
// This is intentionally simple (substring matching) so it's easy to read,
// easy to extend, and fast enough to run on every transaction with no
// external dependency. Users can always override the result by hand, and
// corrections are remembered going forward — see rules.js.

export const CATEGORIES = [
  'Groceries',
  'Rent',
  'Utilities',
  'Dining & Coffee',
  'Subscriptions',
  'Car Expense',
  'Gas',
  'Transportation',
  'Travel',
  'Shopping',
  'Health Expense',
  'Fitness/Training Expense',
  'Entertainment',
  'Income',
  'Transfers',
  'Other',
];

// Colors are picked to stay distinguishable in both light and dark themes.
export const CATEGORY_COLORS = {
  'Groceries': '#22a06b',
  'Rent': '#b45309',
  'Utilities': '#d97706',
  'Dining & Coffee': '#e8734a',
  'Subscriptions': '#8b5cf6',
  'Car Expense': '#0891b2',
  'Gas': '#2563eb',
  'Transportation': '#3b82f6',
  'Travel': '#0ea5b7',
  'Shopping': '#db2777',
  'Health Expense': '#dc2626',
  'Fitness/Training Expense': '#65a30d',
  'Entertainment': '#c026d3',
  'Income': '#16a34a',
  'Transfers': '#64748b',
  'Other': '#9ca3af',
};

// Categories that represent money moving between your own accounts or in
// as real income — never counted as "spending", and only "Income" counts
// toward cash-flow income.
export const NON_EXPENSE_CATEGORIES = ['Income', 'Transfers'];

// For the "Essential vs. Non-Essential" breakdown. Expense categories not
// listed here default to non-essential (including "Other" — uncategorized
// spending shouldn't be assumed necessary).
export const ESSENTIAL_CATEGORIES = [
  'Groceries', 'Rent', 'Utilities', 'Car Expense', 'Gas', 'Transportation',
  'Health Expense',
];

export function isEssential(category) {
  return ESSENTIAL_CATEGORIES.includes(category);
}

// Ordered rule list — first match wins. Keep more-specific brand names
// above broader generic words to avoid one category swallowing another.
const RULES = [
  ['Groceries', [
    "TRADER JOE", 'WHOLE FOODS', 'SAFEWAY', 'KROGER', 'ALDI', 'SPROUTS',
    'H-E-B', ' HEB ', 'PUBLIX', 'WEGMANS', 'VONS', 'RALPHS', 'FOOD LION',
    'WINCO', 'GROCERY', 'GROCER', 'FRESH MARKET', 'SMITHS FOOD',
  ]],
  ['Rent', [
    'BILTRENT', 'BILT PAYMENT', 'RENT PAYMENT', 'MORTGAGE', 'APARTMENTS',
    'PROPERTY MGMT', 'PROPERTY MANAGEMENT', 'REALTY', 'LEASING OFFICE',
  ]],
  ['Utilities', [
    'COMCAST', 'XFINITY', 'AT&T', 'VERIZON', 'T-MOBILE', 'PG&E', 'PGE ',
    'ELECTRIC', 'WATER UTIL', 'GAS UTIL', 'INTERNET SVC', 'INSURANCE',
    'GEICO', 'STATE FARM', 'PROGRESSIVE', 'ALLSTATE', 'SURE INSURANCE',
    'CABLE SVCS', 'UTILITY', 'PHONE BILL', 'WIRELESS',
  ]],
  ['Subscriptions', [
    'NETFLIX', 'SPOTIFY', 'HULU', 'DISNEY+', 'DISNEY PLUS', 'APPLE.COM/BILL',
    'APPLE MUSIC', 'YOUTUBE PREMIUM', 'AMAZON PRIME', 'PRIME VIDEO',
    'OPENAI', 'CHATGPT', 'XBOX GAME PASS', 'PLAYSTATION PLUS', 'ADOBE',
    'ICLOUD', 'GOOGLE STORAGE', 'GOOGLE ONE', 'GOOGLE *YOUTUBE', 'NYTIMES',
    'WASHINGTONPOST', 'AUDIBLE', 'PATREON', 'SIRIUSXM', 'PARAMOUNT+',
    'HBO MAX', 'PEACOCK', 'KINDLE UNLTD', 'SUBSCRIPTION',
  ]],
  ['Health Expense', [
    'GROW THERAPY', 'GROWTHERAPY', 'PHARMACY', 'CVS', 'WALGREENS', 'DOCTOR',
    'MEDICAL', 'DENTAL', 'CLINIC', 'THERAPY', 'OPTOMETR', 'UROGENT CARE',
    'URGENT CARE', 'HEALTH',
  ]],
  ['Fitness/Training Expense', [
    'GYM', 'FITNESS', 'PLANET FITNESS', 'EQUINOX', 'YOGA', 'PILATES',
    'CROSSFIT', 'PELOTON', 'PERSONAL TRAINER', 'TRAINING',
  ]],
  ['Travel', [
    'UNITED ', 'DELTA ', 'SOUTHWEST', 'AMERICAN AIRLINES', 'ALASKA AIR',
    'JETBLUE', 'AIRLINES', 'AIRBNB', 'HOTEL', 'MARRIOTT', 'HILTON', 'HYATT',
    'EXPEDIA', 'BOOKING.COM', 'VRBO', 'VAN LINES', 'RESORT',
  ]],
  ['Gas', [
    'ARCO#', 'ARCO ', 'CHEVRON', 'SHELL OIL', 'EXXON', 'MOBIL',
    'GAS STATION', 'COSTCO GAS', '76 ', 'VALERO', 'CIRCLE K', 'CONOCO',
    'SUNOCO', 'PHILLIPS 66',
  ]],
  ['Car Expense', [
    'PARKING', 'FASTRAK', 'TOLL', 'THRIFTY', 'HERTZ', 'AVIS',
    'ENTERPRISE RENT', ' RAC ', 'RENTAL CAR', 'GARAGE', 'AUTO REPAIR',
    'MECHANIC', ' DMV ', 'CAR WASH', 'OIL CHANGE', 'AUTOZONE', "O'REILLY",
  ]],
  ['Transportation', [
    'UBER *TRIP', 'UBER TRIP', 'LYFT', 'WAYMO', 'TAXI', 'BART ', 'CALTRAIN',
    'MTA ', 'TRANSIT',
  ]],
  ['Shopping', [
    'AMAZON', 'TARGET', 'WALMART', 'WAL-MART', 'ROSS STORES', 'ABERCROMBIE',
    'URBAN OUTFITTERS', 'ADIDAS', 'NIKE', 'SEPHORA', 'ULTA', 'BEST BUY',
    "MACY'S", 'NORDSTROM', 'TJ MAXX', 'MARSHALLS', 'HOME DEPOT', 'LOWES',
    'IKEA', 'ETSY', 'EBAY', 'ZARA', 'H&M', 'GAP ', 'OLD NAVY',
    'COSTCO WHOLESALE', 'BOOKSTORE', 'CAMPUS BKST',
  ]],
  ['Entertainment', [
    'SKY ZONE', 'MOVIE', 'CINEMA', 'AMC ', 'REGAL', 'TICKETMASTER',
    'STUBHUB', 'CONCERT', 'MUSEUM', ' ZOO ', 'BOWLING', 'ARCADE',
  ]],
  ['Income', [
    'PAYROLL', 'INTEREST EARNED', 'INTEREST PAID', 'CASHREWARD', 'CASH BACK',
    'CASHBACK', 'DIRECT DEPOSIT', 'REFUND', 'DIVIDEND', 'BANKAMERIDEALS',
  ]],
  ['Transfers', [
    'PAYMENT - THANK YOU', 'ONLINE PAYMENT FROM', 'ONLINE BANKING TRANSFER',
    'ONLINE BANKING PAYMENT', 'ZELLE', 'VENMO', 'PAYPAL TRANSFER',
    'CREDIT CARD BILL PAYMENT', 'CREDIT CARD PAYMENT', 'TRANSFER FROM',
    'TRANSFER TO', 'ATM WITHDRWL', 'ATM DEPOSIT',
    'ROBINHOOD', 'FIDELITY', 'SCHWAB', 'VANGUARD', 'E*TRADE', 'ETRADE',
    'COINBASE', 'KRAKEN', 'BROKERAGE', 'ACORNS', 'WEALTHFRONT', 'BETTERMENT',
  ]],
  ['Dining & Coffee', [
    'STARBUCKS', 'DOORDASH', 'UBER *EATS', 'UBER EATS', 'GRUBHUB',
    'POSTMATES', 'RESTAURANT', 'CAFE', 'COFFEE', 'PIZZA', 'TACO', 'BURGER',
    'GRILL', 'KITCHEN', 'BISTRO', 'DINER', 'BAKERY', 'SUSHI', 'THAI',
    'WETZEL', 'IN-N-OUT', 'CHICK-FIL-A', 'CHIPOTLE', 'PANERA', "MCDONALD",
    'WENDY', 'SUBWAY', 'DUNKIN', 'PRETZEL', 'MATCHA', 'BOBA', 'DESSERT',
    'BREW', 'TAQUERIA', 'DELI', 'ICE CREAM', 'DONUT', 'NOODLE', 'RAMEN',
    'CUISINE', 'EATERY', 'SWEETGREEN',
    'TST*', 'TST *', 'SQ *', 'SQ*',
  ]],
];

/**
 * Suggest a category for a transaction description.
 * @param {string} description
 * @param {boolean} isDebit - true if this transaction is money going out
 * @returns {string} one of CATEGORIES
 */
export function categorize(description, isDebit) {
  const text = ` ${(description || '').toUpperCase()} `;

  for (const [category, keywords] of RULES) {
    for (const kw of keywords) {
      if (text.includes(kw.toUpperCase())) {
        return category;
      }
    }
  }

  return isDebit ? 'Other' : 'Income';
}
