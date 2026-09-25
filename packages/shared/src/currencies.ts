/**
 * ISO 4217 currencies supported for wallets and balances.
 * `[code, minor units (decimal places), English name]`
 */
const TABLE: ReadonlyArray<readonly [string, number, string]> = [
  ['AED', 2, 'United Arab Emirates Dirham'],
  ['AFN', 2, 'Afghan Afghani'],
  ['ALL', 2, 'Albanian Lek'],
  ['AMD', 2, 'Armenian Dram'],
  ['AOA', 2, 'Angolan Kwanza'],
  ['ARS', 2, 'Argentine Peso'],
  ['AUD', 2, 'Australian Dollar'],
  ['AWG', 2, 'Aruban Florin'],
  ['AZN', 2, 'Azerbaijani Manat'],
  ['BAM', 2, 'Bosnia-Herzegovina Convertible Mark'],
  ['BBD', 2, 'Barbadian Dollar'],
  ['BDT', 2, 'Bangladeshi Taka'],
  ['BHD', 3, 'Bahraini Dinar'],
  ['BIF', 0, 'Burundian Franc'],
  ['BMD', 2, 'Bermudan Dollar'],
  ['BND', 2, 'Brunei Dollar'],
  ['BOB', 2, 'Bolivian Boliviano'],
  ['BRL', 2, 'Brazilian Real'],
  ['BSD', 2, 'Bahamian Dollar'],
  ['BTN', 2, 'Bhutanese Ngultrum'],
  ['BWP', 2, 'Botswanan Pula'],
  ['BYN', 2, 'Belarusian Ruble'],
  ['BZD', 2, 'Belize Dollar'],
  ['CAD', 2, 'Canadian Dollar'],
  ['CDF', 2, 'Congolese Franc'],
  ['CHF', 2, 'Swiss Franc'],
  ['CLP', 0, 'Chilean Peso'],
  ['CNY', 2, 'Chinese Yuan'],
  ['COP', 2, 'Colombian Peso'],
  ['CRC', 2, 'Costa Rican Colón'],
  ['CUP', 2, 'Cuban Peso'],
  ['CVE', 2, 'Cape Verdean Escudo'],
  ['CZK', 2, 'Czech Koruna'],
  ['DJF', 0, 'Djiboutian Franc'],
  ['DKK', 2, 'Danish Krone'],
  ['DOP', 2, 'Dominican Peso'],
  ['DZD', 2, 'Algerian Dinar'],
  ['EGP', 2, 'Egyptian Pound'],
  ['ERN', 2, 'Eritrean Nakfa'],
  ['ETB', 2, 'Ethiopian Birr'],
  ['EUR', 2, 'Euro'],
  ['FJD', 2, 'Fijian Dollar'],
  ['FKP', 2, 'Falkland Islands Pound'],
  ['GBP', 2, 'British Pound'],
  ['GEL', 2, 'Georgian Lari'],
  ['GHS', 2, 'Ghanaian Cedi'],
  ['GIP', 2, 'Gibraltar Pound'],
  ['GMD', 2, 'Gambian Dalasi'],
  ['GNF', 0, 'Guinean Franc'],
  ['GTQ', 2, 'Guatemalan Quetzal'],
  ['GYD', 2, 'Guyanaese Dollar'],
  ['HKD', 2, 'Hong Kong Dollar'],
  ['HNL', 2, 'Honduran Lempira'],
  ['HTG', 2, 'Haitian Gourde'],
  ['HUF', 2, 'Hungarian Forint'],
  ['IDR', 2, 'Indonesian Rupiah'],
  ['ILS', 2, 'Israeli New Shekel'],
  ['INR', 2, 'Indian Rupee'],
  ['IQD', 3, 'Iraqi Dinar'],
  ['IRR', 2, 'Iranian Rial'],
  ['ISK', 0, 'Icelandic Króna'],
  ['JMD', 2, 'Jamaican Dollar'],
  ['JOD', 3, 'Jordanian Dinar'],
  ['JPY', 0, 'Japanese Yen'],
  ['KES', 2, 'Kenyan Shilling'],
  ['KGS', 2, 'Kyrgyz Som'],
  ['KHR', 2, 'Cambodian Riel'],
  ['KMF', 0, 'Comorian Franc'],
  ['KPW', 2, 'North Korean Won'],
  ['KRW', 0, 'South Korean Won'],
  ['KWD', 3, 'Kuwaiti Dinar'],
  ['KYD', 2, 'Cayman Islands Dollar'],
  ['KZT', 2, 'Kazakhstani Tenge'],
  ['LAK', 2, 'Laotian Kip'],
  ['LBP', 2, 'Lebanese Pound'],
  ['LKR', 2, 'Sri Lankan Rupee'],
  ['LRD', 2, 'Liberian Dollar'],
  ['LSL', 2, 'Lesotho Loti'],
  ['LYD', 3, 'Libyan Dinar'],
  ['MAD', 2, 'Moroccan Dirham'],
  ['MDL', 2, 'Moldovan Leu'],
  ['MGA', 2, 'Malagasy Ariary'],
  ['MKD', 2, 'Macedonian Denar'],
  ['MMK', 2, 'Myanmar Kyat'],
  ['MNT', 2, 'Mongolian Tugrik'],
  ['MOP', 2, 'Macanese Pataca'],
  ['MRU', 2, 'Mauritanian Ouguiya'],
  ['MUR', 2, 'Mauritian Rupee'],
  ['MVR', 2, 'Maldivian Rufiyaa'],
  ['MWK', 2, 'Malawian Kwacha'],
  ['MXN', 2, 'Mexican Peso'],
  ['MYR', 2, 'Malaysian Ringgit'],
  ['MZN', 2, 'Mozambican Metical'],
  ['NAD', 2, 'Namibian Dollar'],
  ['NGN', 2, 'Nigerian Naira'],
  ['NIO', 2, 'Nicaraguan Córdoba'],
  ['NOK', 2, 'Norwegian Krone'],
  ['NPR', 2, 'Nepalese Rupee'],
  ['NZD', 2, 'New Zealand Dollar'],
  ['OMR', 3, 'Omani Rial'],
  ['PAB', 2, 'Panamanian Balboa'],
  ['PEN', 2, 'Peruvian Sol'],
  ['PGK', 2, 'Papua New Guinean Kina'],
  ['PHP', 2, 'Philippine Peso'],
  ['PKR', 2, 'Pakistani Rupee'],
  ['PLN', 2, 'Polish Zloty'],
  ['PYG', 0, 'Paraguayan Guarani'],
  ['QAR', 2, 'Qatari Riyal'],
  ['RON', 2, 'Romanian Leu'],
  ['RSD', 2, 'Serbian Dinar'],
  ['RUB', 2, 'Russian Ruble'],
  ['RWF', 0, 'Rwandan Franc'],
  ['SAR', 2, 'Saudi Riyal'],
  ['SBD', 2, 'Solomon Islands Dollar'],
  ['SCR', 2, 'Seychellois Rupee'],
  ['SDG', 2, 'Sudanese Pound'],
  ['SEK', 2, 'Swedish Krona'],
  ['SGD', 2, 'Singapore Dollar'],
  ['SHP', 2, 'St. Helena Pound'],
  ['SLE', 2, 'Sierra Leonean Leone'],
  ['SOS', 2, 'Somali Shilling'],
  ['SRD', 2, 'Surinamese Dollar'],
  ['SSP', 2, 'South Sudanese Pound'],
  ['STN', 2, 'São Tomé & Príncipe Dobra'],
  ['SVC', 2, 'Salvadoran Colón'],
  ['SYP', 2, 'Syrian Pound'],
  ['SZL', 2, 'Swazi Lilangeni'],
  ['THB', 2, 'Thai Baht'],
  ['TJS', 2, 'Tajikistani Somoni'],
  ['TMT', 2, 'Turkmenistani Manat'],
  ['TND', 3, 'Tunisian Dinar'],
  ['TOP', 2, 'Tongan Paʻanga'],
  ['TRY', 2, 'Turkish Lira'],
  ['TTD', 2, 'Trinidad & Tobago Dollar'],
  ['TWD', 2, 'New Taiwan Dollar'],
  ['TZS', 2, 'Tanzanian Shilling'],
  ['UAH', 2, 'Ukrainian Hryvnia'],
  ['UGX', 0, 'Ugandan Shilling'],
  ['USD', 2, 'US Dollar'],
  ['UYU', 2, 'Uruguayan Peso'],
  ['UZS', 2, 'Uzbekistani Som'],
  ['VED', 2, 'Bolívar Soberano'],
  ['VES', 2, 'Venezuelan Bolívar'],
  ['VND', 0, 'Vietnamese Dong'],
  ['VUV', 0, 'Vanuatu Vatu'],
  ['WST', 2, 'Samoan Tala'],
  ['XAF', 0, 'Central African CFA Franc'],
  ['XCD', 2, 'East Caribbean Dollar'],
  ['XCG', 2, 'Caribbean guilder'],
  ['XOF', 0, 'West African CFA Franc'],
  ['XPF', 0, 'CFP Franc'],
  ['YER', 2, 'Yemeni Rial'],
  ['ZAR', 2, 'South African Rand'],
  ['ZMW', 2, 'Zambian Kwacha'],
  ['ZWG', 2, 'Zimbabwean Gold'],
];

export interface Currency {
  code: string;
  decimals: number;
  name: string;
  /** Issued by a virtual country in the registry (not ISO 4217). */
  virtual?: boolean;
}

const LIST: Currency[] = TABLE.map(([code, decimals, name]) => ({ code, decimals, name }));
const CODES: string[] = LIST.map((c) => c.code);
const BY_CODE = new Map(LIST.map((c) => [c.code, c]));

/** Every currency the platform knows: ISO 4217, then virtual currencies once registered. */
export const CURRENCIES: readonly Currency[] = LIST;
export const CURRENCY_CODES: readonly string[] = CODES;
export const ISO_CURRENCY_CODES: ReadonlySet<string> = new Set(CODES);

/**
 * Add (or update) currencies that are not in ISO 4217: virtual-country currencies. Clients call
 * this with GET /currencies at start-up; the server with its own table.
 */
export function registerCurrencies(list: readonly Currency[]) {
  for (const c of list) {
    if (ISO_CURRENCY_CODES.has(c.code)) continue;
    const known = BY_CODE.get(c.code);
    if (known) Object.assign(known, c);
    else {
      const added = { ...c, virtual: true };
      LIST.push(added);
      CODES.push(c.code);
      BY_CODE.set(c.code, added);
    }
  }
}

/** Three letters that are not an ISO 4217 code. */
export const VIRTUAL_CURRENCY_CODE = /^[A-Z]{3}$/;

export function isCurrency(code: string): boolean {
  return BY_CODE.has(code);
}

export function getCurrency(code: string): Currency {
  const currency = BY_CODE.get(code);
  if (!currency) throw new Error(`Unsupported currency: ${code}`);
  return currency;
}
