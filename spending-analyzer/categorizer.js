// Keyword-based auto-categorization for transaction descriptions.
// This is intentionally simple (substring matching) so it's easy to read,
// easy to extend, and fast enough to run on every transaction with no
// external dependency. Users can always override the result by hand.

export const CATEGORIES = [
  'Groceries',
  'Dining & Coffee',
  'Subscriptions',
  'Transportation',
  'Travel',
  'Shopping',
  'Bills & Utilities',
  'Health & Fitness',
  'Entertainment',
  'Income & Transfers',
  'Other',
];

// Colors are picked to stay distinguishable in both light and dark themes.
export const CATEGORY_COLORS = {
  'Groceries': '#22a06b',
  'Dining & Coffee': '#e8734a',
  'Subscriptions': '#8b5cf6',
  'Transportation': '#3b82f6',
  'Travel': '#0ea5b7',
  'Shopping': '#db2777',
  'Bills & Utilities': '#d97706',
  'Health & Fitness': '#16a34a',
  'Entertainment': '#c026d3',
  'Income & Transfers': '#64748b',
  'Other': '#9ca3af',
};

// Ordered rule list — first match wins. Keep more-specific brand names
// above broader generic words to avoid one category swallowing another.
const RULES = [
  ['Groceries', [
    "TRADER JOE", 'WHOLE FOODS', 'SAFEWAY', 'KROGER', 'ALDI', 'SPROUTS',
    'H-E-B', ' HEB ', 'PUBLIX', 'WEGMANS', 'VONS', 'RALPHS', 'FOOD LION',
    'WINCO', 'GROCERY', 'GROCER', 'FRESH MARKET', 'SMITHS FOOD',
  ]],
  ['Subscriptions', [
    'NETFLIX', 'SPOTIFY', 'HULU', 'DISNEY+', 'DISNEY PLUS', 'APPLE.COM/BILL',
    'APPLE MUSIC', 'YOUTUBE PREMIUM', 'AMAZON PRIME', 'PRIME VIDEO',
    'OPENAI', 'CHATGPT', 'XBOX GAME PASS', 'PLAYSTATION PLUS', 'ADOBE',
    'ICLOUD', 'GOOGLE STORAGE', 'GOOGLE ONE', 'GOOGLE *YOUTUBE', 'NYTIMES',
    'WASHINGTONPOST', 'AUDIBLE', 'PATREON', 'SIRIUSXM', 'PARAMOUNT+',
    'HBO MAX', 'PEACOCK', 'KINDLE UNLTD', 'SUBSCRIPTION',
  ]],
  ['Bills & Utilities', [
    'COMCAST', 'XFINITY', 'AT&T', 'VERIZON', 'T-MOBILE', 'PG&E', 'PGE ',
    'ELECTRIC', 'WATER UTIL', 'GAS UTIL', 'INTERNET SVC', 'INSURANCE',
    'GEICO', 'STATE FARM', 'PROGRESSIVE', 'ALLSTATE', 'SURE INSURANCE',
    'CABLE SVCS', 'BILTRENT', 'BILT PAYMENT', 'RENT PAYMENT', 'MORTGAGE',
    'UTILITY', 'PHONE BILL', 'WIRELESS',
  ]],
  ['Health & Fitness', [
    'GROW THERAPY', 'GROWTHERAPY', 'PHARMACY', 'CVS', 'WALGREENS', 'GYM',
    'FITNESS', 'PLANET FITNESS', 'EQUINOX', 'DOCTOR', 'MEDICAL', 'DENTAL',
    'CLINIC', 'THERAPY', 'HEALTH', 'OPTOMETR', 'UROGENT CARE', 'URGENT CARE',
  ]],
  ['Travel', [
    'UNITED ', 'DELTA ', 'SOUTHWEST', 'AMERICAN AIRLINES', 'ALASKA AIR',
    'JETBLUE', 'AIRLINES', 'AIRBNB', 'HOTEL', 'MARRIOTT', 'HILTON', 'HYATT',
    'EXPEDIA', 'BOOKING.COM', 'VRBO', 'VAN LINES', 'RESORT',
  ]],
  ['Transportation', [
    'UBER *TRIP', 'UBER TRIP', 'LYFT', 'WAYMO', 'PARKING', 'ARCO#', 'ARCO ',
    'CHEVRON', 'SHELL OIL', 'EXXON', 'MOBIL', 'FASTRAK', 'TOLL', 'GAS STATION',
    'COSTCO GAS', 'BART ', 'CALTRAIN', 'MTA ', 'TAXI', 'RENTAL CAR',
    'THRIFTY', 'HERTZ', 'AVIS', 'ENTERPRISE RENT', ' RAC ', 'TRANSIT',
    'GARAGE',
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
  ['Income & Transfers', [
    'PAYROLL', 'PAYMENT - THANK YOU', 'ONLINE PAYMENT FROM',
    'ONLINE BANKING TRANSFER', 'ONLINE BANKING PAYMENT', 'ZELLE', 'VENMO',
    'ROBINHOOD', 'CREDIT CARD BILL PAYMENT', 'CREDIT CARD PAYMENT',
    'INTEREST EARNED', 'INTEREST PAID', 'CASHREWARD', 'CASH BACK',
    'DIRECT DEPOSIT', 'REFUND', 'TRANSFER FROM', 'TRANSFER TO', 'ATM WITHDRWL',
    'ATM DEPOSIT', 'PAYPAL TRANSFER',
  ]],
  ['Dining & Coffee', [
    'STARBUCKS', 'DOORDASH', 'UBER *EATS', 'UBER EATS', 'GRUBHUB',
    'POSTMATES', 'RESTAURANT', 'CAFE', 'COFFEE', 'PIZZA', 'TACO', 'BURGER',
    'GRILL', 'KITCHEN', 'BISTRO', 'DINER', 'BAKERY', 'SUSHI', 'THAI',
    'WETZEL', 'IN-N-OUT', 'CHICK-FIL-A', 'CHIPOTLE', 'PANERA', "MCDONALD",
    'WENDY', 'SUBWAY', 'DUNKIN', 'PRETZEL', 'MATCHA', 'BOBA', 'DESSERT',
    'BREW', 'TAQUERIA', 'DELI', 'ICE CREAM', 'DONUT', 'NOODLE', 'RAMEN',
    'CUISINE', 'EATERY',
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

  return isDebit ? 'Other' : 'Income & Transfers';
}
