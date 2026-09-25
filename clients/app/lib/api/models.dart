// Data models of the OVL For Business API (v1). Field names mirror
// packages/shared/src/api.ts; money is always a decimal string.

typedef Json = Map<String, dynamic>;

DateTime _date(Object? v) => DateTime.parse(v as String).toLocal();
DateTime? _dateOrNull(Object? v) => v == null ? null : _date(v);
List<T> _list<T>(Object? v, T Function(Json) f) => (v as List? ?? const []).map((e) => f(e as Json)).toList();

const roleLabels = {
  'user': 'User',
  'moderator': 'Moderator',
  'manager': 'Finance manager',
  'council': 'Council member',
  'admin': 'Administrator',
  'owner': 'Owner',
};

const badgeLabels = {
  'owner': 'Owner',
  'admin': 'Admin',
  'council': 'Council',
  'moderator': 'Moderator',
  'manager': 'Finance',
  'support': 'Support',
};

const licenseTypeLabels = {
  'project': 'Project',
  'fan_project': 'Fan-project',
  'tv_channel': 'TV channel',
  'radio_channel': 'Radio channel',
  'verified_website': 'Verified website',
  'virtual_country': 'Virtual country',
  'media': 'Media / publication',
  'software': 'Software / service',
  'game': 'Game / game server',
  'community': 'Community',
  'business': 'Business license',
  'other': 'Other (virtual)',
};

class UserSummary {
  UserSummary({
    required this.id,
    required this.username,
    required this.displayName,
    required this.avatarUrl,
    required this.role,
    required this.badges,
  });

  factory UserSummary.fromJson(Json j) => UserSummary(
    id: j['id'] as String,
    username: j['username'] as String,
    displayName: j['displayName'] as String,
    avatarUrl: j['avatarUrl'] as String?,
    role: j['role'] as String,
    badges: List<String>.from(j['badges'] as List? ?? const []),
  );

  final String id;
  final String username;
  final String displayName;
  final String? avatarUrl;
  final String role;
  final List<String> badges;

  Json toJson() => {
    'id': id,
    'username': username,
    'displayName': displayName,
    'avatarUrl': avatarUrl,
    'role': role,
    'badges': badges,
  };
}

class UserProfile extends UserSummary {
  UserProfile.fromJson(Json j)
    : bio = j['bio'] as String? ?? '',
      createdAt = _date(j['createdAt']),
      isContact = j['isContact'] as bool? ?? false,
      super(
        id: j['id'] as String,
        username: j['username'] as String,
        displayName: j['displayName'] as String,
        avatarUrl: j['avatarUrl'] as String?,
        role: j['role'] as String,
        badges: List<String>.from(j['badges'] as List? ?? const []),
      );

  final String bio;
  final DateTime createdAt;
  final bool isContact;
}

class Preferences {
  const Preferences({
    this.theme,
    this.onboardingCompleted = false,
    this.goals = const [],
    this.statementEmails = false,
  });

  factory Preferences.fromJson(Json? j) => Preferences(
    theme: j?['theme'] as String?,
    onboardingCompleted: j?['onboardingCompleted'] as bool? ?? false,
    goals: List<String>.from(j?['goals'] as List? ?? const []),
    statementEmails: j?['statementEmails'] as bool? ?? false,
  );

  final String? theme;
  final bool onboardingCompleted;
  final List<String> goals;

  /// Email a PDF statement of every balance at the start of each month.
  final bool statementEmails;
}

class Me extends UserSummary {
  Me.fromJson(Json j)
    : email = j['email'] as String,
      bio = j['bio'] as String? ?? '',
      status = j['status'] as String,
      permissions = List<String>.from(j['permissions'] as List? ?? const []),
      preferences = Preferences.fromJson(j['preferences'] as Json?),
      twoFactorEnabled = j['twoFactorEnabled'] as bool? ?? false,
      emailVerified = j['emailVerified'] as bool? ?? true,
      identityVerified = j['identityVerified'] as bool? ?? false,
      createdAt = _date(j['createdAt']),
      super(
        id: j['id'] as String,
        username: j['username'] as String,
        displayName: j['displayName'] as String,
        avatarUrl: j['avatarUrl'] as String?,
        role: j['role'] as String,
        badges: List<String>.from(j['badges'] as List? ?? const []),
      );

  final String email;
  final String bio;
  final String status;
  final List<String> permissions;
  final Preferences preferences;
  final bool twoFactorEnabled;
  final bool emailVerified;
  final bool identityVerified;
  final DateTime createdAt;

  bool can(String permission) => permissions.contains(permission);
  bool get isStaff => const ['moderator', 'council', 'admin', 'owner'].contains(role);
  String get firstName => displayName.split(' ').first;
}

class AuthResult {
  AuthResult.fromJson(Json j)
    : accessToken = j['accessToken'] as String,
      refreshToken = j['refreshToken'] as String,
      user = Me.fromJson(j['user'] as Json);

  final String accessToken;
  final String refreshToken;
  final Me user;
}

class TwoFactorStatus {
  TwoFactorStatus.fromJson(Json j)
    : enabled = j['enabled'] as bool,
      enabledAt = _dateOrNull(j['enabledAt']),
      recoveryCodesLeft = j['recoveryCodesLeft'] as int;

  final bool enabled;
  final DateTime? enabledAt;
  final int recoveryCodesLeft;
}

/// A device signed in to the account.
class SessionInfo {
  SessionInfo.fromJson(Json j)
    : id = j['id'] as String,
      device = j['device'] as String,
      kind = j['kind'] as String,
      ip = j['ip'] as String?,
      createdAt = _date(j['createdAt']),
      lastUsedAt = _date(j['lastUsedAt']),
      current = j['current'] as bool? ?? false;

  final String id;
  final String device;
  final String kind;
  final String? ip;
  final DateTime createdAt;
  final DateTime lastUsedAt;
  final bool current;
}

class Contact extends UserSummary {
  Contact.fromJson(Json j)
    : addedAt = _date(j['addedAt']),
      super(
        id: j['id'] as String,
        username: j['username'] as String,
        displayName: j['displayName'] as String,
        avatarUrl: j['avatarUrl'] as String?,
        role: j['role'] as String,
        badges: List<String>.from(j['badges'] as List? ?? const []),
      );

  final DateTime addedAt;
}

class Wallet {
  Wallet.fromJson(Json j)
    : id = j['id'] as String,
      ownerType = j['ownerType'] as String,
      ownerId = j['ownerId'] as String,
      currency = j['currency'] as String,
      balance = j['balance'] as String,
      frozen = j['frozen'] as String,
      available = j['available'] as String,
      createdAt = _date(j['createdAt']);

  final String id;
  final String ownerType;
  final String ownerId;
  final String currency;
  final String balance;
  final String frozen;
  final String available;
  final DateTime createdAt;

  bool get hasFrozen => (double.tryParse(frozen) ?? 0) > 0;
}

/// A company payment above its approval limit, waiting for (or decided by) a second finance member.
class PaymentApproval {
  PaymentApproval.fromJson(Json j)
    : id = j['id'] as String,
      organizationId = j['organizationId'] as String,
      walletId = j['walletId'] as String,
      kind = j['kind'] as String,
      amount = j['amount'] as String,
      currency = j['currency'] as String,
      description = j['description'] as String,
      status = j['status'] as String,
      requestedById = (j['requestedBy'] as Json)['id'] as String,
      requestedBy = (j['requestedBy'] as Json)['displayName'] as String,
      decidedBy = (j['decidedBy'] as Json?)?['displayName'] as String?,
      reason = j['reason'] as String?,
      createdAt = _date(j['createdAt']),
      decidedAt = _dateOrNull(j['decidedAt']);

  /// Payment endpoints answer 202 with one of these instead of the finished result.
  static bool matches(Object? j) => j is Json && j.containsKey('kind') && j.containsKey('requestedBy');

  final String id;
  final String organizationId;
  final String walletId;

  /// transfer, invoice, exchange or payroll
  final String kind;
  final String amount;
  final String currency;
  final String description;
  final String status;
  final String requestedById;

  /// Display names.
  final String requestedBy;
  final String? decidedBy;
  final String? reason;
  final DateTime createdAt;
  final DateTime? decidedAt;
}

/// Exchange rates against the base currency, and the fee.
class ExchangeInfo {
  ExchangeInfo.fromJson(Json j)
    : base = j['base'] as String,
      feePercent = j['feePercent'] as String,
      rates = {for (final r in j['rates'] as List) (r as Json)['currency'] as String: r['rate'] as String};

  final String base;
  final String feePercent;

  /// Currency → what one unit is worth in [base].
  final Map<String, String> rates;

  List<String> targetsFrom(String currency) => [base, ...rates.keys].where((c) => c != currency).toList();
}

class ExchangeQuote {
  ExchangeQuote.fromJson(Json j)
    : fromCurrency = j['fromCurrency'] as String,
      toCurrency = j['toCurrency'] as String,
      amount = j['amount'] as String,
      fee = j['fee'] as String,
      receive = j['receive'] as String,
      rate = j['rate'] as String;

  final String fromCurrency;
  final String toCurrency;
  final String amount;
  final String fee;
  final String receive;

  /// Target units per source unit.
  final String rate;
}

/// A deposit or payout someone asked a finance manager for.
class CashRequest {
  CashRequest.fromJson(Json j)
    : id = j['id'] as String,
      walletId = j['walletId'] as String,
      type = j['type'] as String,
      method = j['method'] as String,
      amount = j['amount'] as String,
      currency = j['currency'] as String,
      note = j['note'] as String? ?? '',
      status = j['status'] as String,
      requestedBy = (j['requestedBy'] as Json)['username'] as String,
      handledBy = (j['handledBy'] as Json?)?['displayName'] as String?,
      reference = j['reference'] as String?,
      declineReason = j['declineReason'] as String?,
      createdAt = _date(j['createdAt']),
      handledAt = _dateOrNull(j['handledAt']);

  final String id;
  final String walletId;
  final String type;
  final String method;
  final String amount;
  final String currency;
  final String note;
  final String status;
  final String requestedBy;
  final String? handledBy;
  final String? reference;
  final String? declineReason;
  final DateTime createdAt;
  final DateTime? handledAt;

  bool get isDeposit => type == 'deposit';
  bool get isPending => status == 'pending';
}

/// A person or a company on an invoice.
class InvoiceParty {
  InvoiceParty.fromJson(Json j)
    : type = j['type'] as String,
      id = j['id'] as String,
      name = j['name'] as String,
      handle = j['handle'] as String;

  final String type;
  final String id;
  final String name;
  final String handle;

  bool get isCompany => type == 'organization';
}

class InvoiceItem {
  InvoiceItem.fromJson(Json j)
    : description = j['description'] as String,
      quantity = j['quantity'] as int,
      unitPrice = j['unitPrice'] as String,
      amount = j['amount'] as String;

  final String description;
  final int quantity;
  final String unitPrice;
  final String amount;
}

class Invoice {
  Invoice.fromJson(Json j)
    : id = j['id'] as String,
      number = j['number'] as String,
      direction = j['direction'] as String,
      issuer = InvoiceParty.fromJson(j['issuer'] as Json),
      recipient = InvoiceParty.fromJson(j['recipient'] as Json),
      currency = j['currency'] as String,
      items = [for (final i in j['items'] as List) InvoiceItem.fromJson(i as Json)],
      total = j['total'] as String,
      amountPaid = j['amountPaid'] as String? ?? '0',
      amountDue = j['amountDue'] as String? ?? j['total'] as String,
      payments = [
        for (final p in j['payments'] as List? ?? const [])
          (
            amount: (p as Json)['amount'] as String,
            paidBy: (p['paidBy'] as Json)['displayName'] as String,
            at: _date(p['createdAt']),
          ),
      ],
      recurringInterval = (j['recurring'] as Json?)?['interval'] as String?,
      note = j['note'] as String? ?? '',
      dueDate = DateTime.parse(j['dueDate'] as String),
      status = j['status'] as String,
      overdue = j['overdue'] as bool,
      createdAt = _date(j['createdAt']),
      paidAt = _dateOrNull(j['paidAt']),
      paidBy = (j['paidBy'] as Json?)?['displayName'] as String?,
      cancelReason = j['cancelReason'] as String?;

  final String id;
  final String number;
  final String direction;
  final InvoiceParty issuer;
  final InvoiceParty recipient;
  final String currency;
  final List<InvoiceItem> items;
  final String total;

  /// Invoices can be paid in parts.
  final String amountPaid;
  final String amountDue;
  final List<({String amount, String paidBy, DateTime at})> payments;

  /// weekly, monthly, quarterly or yearly when a recurring schedule issued it.
  final String? recurringInterval;
  final String note;
  final DateTime dueDate;
  final String status;
  final bool overdue;
  final DateTime createdAt;
  final DateTime? paidAt;
  final String? paidBy;
  final String? cancelReason;

  bool get incoming => direction == 'incoming';
  bool get isOpen => status == 'open';

  /// The other side, seen from the viewer.
  InvoiceParty get counterparty => incoming ? issuer : recipient;

  bool get partlyPaid => isOpen && (double.tryParse(amountPaid) ?? 0) > 0;

  /// For badges: open invoices past their due date read "overdue".
  String get displayStatus => overdue
      ? 'overdue'
      : partlyPaid
      ? 'partly_paid'
      : status;
}

/// One calendar month of a balance.
class MonthlyStatement {
  MonthlyStatement.fromJson(Json j)
    : month = j['month'] as String,
      from = j['from'] as String,
      to = j['to'] as String,
      moneyIn = j['moneyIn'] as String,
      moneyOut = j['moneyOut'] as String,
      closing = j['closing'] as String,
      operations = j['operations'] as int;

  /// YYYY-MM
  final String month;
  final String from;
  final String to;
  final String moneyIn;
  final String moneyOut;
  final String closing;
  final int operations;
}

/// A recurring invoice: one is issued every period.
class InvoiceSchedule {
  InvoiceSchedule.fromJson(Json j)
    : id = j['id'] as String,
      issuer = InvoiceParty.fromJson(j['issuer'] as Json),
      recipient = InvoiceParty.fromJson(j['recipient'] as Json),
      currency = j['currency'] as String,
      total = j['total'] as String,
      interval = j['interval'] as String,
      nextRunOn = j['nextRunOn'] == null ? null : DateTime.parse(j['nextRunOn'] as String),
      endDate = j['endDate'] == null ? null : DateTime.parse(j['endDate'] as String),
      status = j['status'] as String,
      invoiceCount = j['invoiceCount'] as int;

  final String id;
  final InvoiceParty issuer;
  final InvoiceParty recipient;
  final String currency;
  final String total;
  final String interval;
  final DateTime? nextRunOn;
  final DateTime? endDate;

  /// active, paused or ended
  final String status;
  final int invoiceCount;
}

/// A company paying many people at once.
class PayrollRun {
  PayrollRun.fromJson(Json j)
    : id = j['id'] as String,
      title = j['title'] as String,
      currency = j['currency'] as String,
      total = j['total'] as String,
      status = j['status'] as String,
      people = (j['items'] as List).length,
      createdAt = _date(j['createdAt']);

  final String id;
  final String title;
  final String currency;
  final String total;

  /// pending (waiting for a second signature), paid or rejected
  final String status;
  final int people;
  final DateTime createdAt;
}

class LedgerEntry {
  LedgerEntry.fromJson(Json j)
    : id = j['id'] as int,
      amount = j['amount'] as String,
      balanceAfter = j['balanceAfter'] as String,
      currency = j['currency'] as String,
      kind = j['kind'] as String,
      description = j['description'] as String,
      createdAt = _date(j['createdAt']);

  final int id;
  final String amount;
  final String balanceAfter;
  final String currency;
  final String kind;
  final String description;
  final DateTime createdAt;

  bool get incoming => !amount.startsWith('-');
}

class Paged<T> {
  Paged({required this.items, required this.total});

  factory Paged.fromJson(Json j, T Function(Json) f) => Paged(items: _list(j['items'], f), total: j['total'] as int);

  final List<T> items;
  final int total;
}

class Organization {
  Organization.fromJson(Json j)
    : id = j['id'] as String,
      name = j['name'] as String,
      slug = j['slug'] as String,
      description = j['description'] as String? ?? '',
      website = j['website'] as String?,
      country = j['country'] as String?,
      baseCurrency = j['baseCurrency'] as String,
      status = j['status'] as String,
      registryNumber = j['registryNumber'] as String?,
      ticker = j['ticker'] as String?,
      owner = UserSummary.fromJson(j['owner'] as Json),
      memberCount = j['memberCount'] as int,
      myRole = j['myRole'] as String?,
      verified = j['verified'] as bool? ?? false,
      approvalLimit = j['approvalLimit'] as String?,
      createdAt = _date(j['createdAt']);

  /// Verified business: its owner passed an identity check.
  final bool verified;

  /// Payments of at least this much (base currency) need a second finance member; members only.
  final String? approvalLimit;
  final String id;
  final String name;
  final String slug;
  final String description;
  final String? website;
  final String? country;
  final String baseCurrency;
  final String status;
  final String? registryNumber;
  final String? ticker;
  final UserSummary owner;
  final int memberCount;
  final String? myRole;
  final DateTime createdAt;

  bool get canSeeMoney => const ['owner', 'director', 'accountant'].contains(myRole);
}

/// An uploaded file; `url` is a signed API path (open it in the browser, about an hour).
class FileInfo {
  FileInfo.fromJson(Json j)
    : id = j['id'] as String,
      name = j['name'] as String,
      contentType = j['contentType'] as String,
      size = j['size'] as int,
      url = j['url'] as String;

  final String id;
  final String name;
  final String contentType;
  final int size;
  final String url;

  bool get isImage => contentType.startsWith('image/');
}

class ApplicationReview {
  ApplicationReview.fromJson(Json j)
    : stageKey = j['stageKey'] as String,
      reviewer = UserSummary.fromJson(j['reviewer'] as Json),
      decision = j['decision'] as String,
      comment = j['comment'] as String? ?? '',
      round = j['round'] as int? ?? 1,
      createdAt = _date(j['createdAt']);

  final int round;
  final String stageKey;
  final UserSummary reviewer;
  final String decision;
  final String comment;
  final DateTime createdAt;
}

class Application {
  Application.fromJson(Json j)
    : id = j['id'] as String,
      type = j['type'] as String,
      status = j['status'] as String,
      stageIndex = j['stageIndex'] as int,
      currentStage = j['currentStage'] as String?,
      applicant = UserSummary.fromJson(j['applicant'] as Json),
      payload = (j['payload'] as Json?) ?? {},
      result = j['result'] as Json?,
      rejectionReason = j['rejectionReason'] as String?,
      changesRequested = j['changesRequested'] as String?,
      round = j['round'] as int? ?? 1,
      attachments = _list(j['attachments'], FileInfo.fromJson),
      reviews = _list(j['reviews'], ApplicationReview.fromJson),
      createdAt = _date(j['createdAt']),
      decidedAt = _dateOrNull(j['decidedAt']);

  final String id;
  final String type;
  final String status;
  final int stageIndex;
  final String? currentStage;
  final UserSummary applicant;
  final Json payload;
  final Json? result;
  final String? rejectionReason;
  final String? changesRequested;
  final int round;
  final List<FileInfo> attachments;
  final List<ApplicationReview> reviews;
  final DateTime createdAt;
  final DateTime? decidedAt;

  /// A human title: company name, license title, channel title or the staff role.
  String get title {
    final name = payload['name'] ?? payload['title'];
    if (name is String && name.isNotEmpty) return name;
    return switch (type) {
      'moderator' => 'Join the moderation team',
      'council' => 'Join the council',
      _ => workflows[type]?.label ?? type,
    };
  }
}

class RegistryHolder {
  RegistryHolder.fromJson(Json j)
    : type = j['type'] as String,
      name = j['name'] as String,
      handle = j['handle'] as String,
      verified = j['verified'] as bool? ?? false;

  final String type;
  final String name;
  final String handle;
  final bool verified;
}

class RegistryEntry {
  RegistryEntry.fromJson(Json j)
    : id = j['id'] as String,
      number = j['number'] as String,
      kind = j['kind'] as String,
      licenseType = j['licenseType'] as String?,
      title = j['title'] as String,
      description = j['description'] as String? ?? '',
      website = j['website'] as String?,
      status = j['status'] as String,
      holder = RegistryHolder.fromJson(j['holder'] as Json),
      issuedAt = _date(j['issuedAt']),
      expiresAt = _dateOrNull(j['expiresAt']),
      renewalApplicationId = j['renewalApplicationId'] as String?;

  final String id;
  final String number;
  final String kind;

  /// Licences run for a term and are renewed; companies never expire.
  final DateTime? expiresAt;

  /// A renewal waiting for moderation (only on /me/licences).
  final String? renewalApplicationId;

  /// Renewals open 60 days before expiry and close 90 days after it.
  bool get canRenew {
    final e = expiresAt;
    if (e == null || (status != 'active' && status != 'expired') || renewalApplicationId != null) return false;
    final now = DateTime.now();
    return now.isAfter(e.subtract(const Duration(days: 60))) && now.isBefore(e.add(const Duration(days: 90)));
  }

  final String? licenseType;
  final String title;
  final String description;
  final String? website;
  final String status;
  final RegistryHolder holder;
  final DateTime issuedAt;

  String get kindLabel => kind == 'license'
      ? (licenseTypeLabels[licenseType] ?? 'License')
      : kind == 'virtual_country'
      ? 'Virtual country'
      : 'Organization';
}

class StockListing {
  StockListing.fromJson(Json j)
    : id = j['id'] as String,
      ticker = j['ticker'] as String,
      organizationName = (j['organization'] as Json)['name'] as String,
      organizationSlug = (j['organization'] as Json)['slug'] as String,
      registryNumber = (j['organization'] as Json)['registryNumber'] as String?,
      verified = (j['organization'] as Json)['verified'] as bool? ?? false,
      currency = j['currency'] as String,
      sharePrice = j['sharePrice'] as String,
      totalShares = j['totalShares'] as String,
      sharesSold = j['sharesSold'] as String,
      sharesAvailable = j['sharesAvailable'] as String,
      marketCap = j['marketCap'] as String,
      raised = j['raised'] as String,
      investorsCount = j['investorsCount'] as int,
      freezePercent = (j['freezePercent'] as num).toDouble(),
      lockDays = j['lockDays'] as int,
      status = j['status'] as String,
      listedAt = _date(j['listedAt']),
      description = j['description'] as String? ?? '',
      priceHistory = _list(j['priceHistory'], PricePoint.fromJson);

  final String id;
  final String ticker;

  /// The issuer is a verified business.
  final bool verified;
  final String organizationName;
  final String organizationSlug;
  final String? registryNumber;
  final String currency;
  final String sharePrice;
  final String totalShares;
  final String sharesSold;
  final String sharesAvailable;
  final String marketCap;
  final String raised;
  final int investorsCount;
  final double freezePercent;
  final int lockDays;
  final String status;
  final DateTime listedAt;
  final String description;
  final List<PricePoint> priceHistory;

  /// Change since the first recorded price, in percent (null without history).
  double? get change {
    if (priceHistory.length < 2) return null;
    final first = priceHistory.first.value;
    return first == 0 ? null : (priceHistory.last.value - first) / first * 100;
  }
}

class PricePoint {
  PricePoint.fromJson(Json j) : price = j['price'] as String, at = _date(j['at']);

  final String price;
  final DateTime at;

  double get value => double.tryParse(price) ?? 0;
}

class Holding {
  Holding.fromJson(Json j)
    : ticker = j['ticker'] as String,
      organizationName = j['organizationName'] as String,
      currency = j['currency'] as String,
      shares = j['shares'] as String,
      invested = j['invested'] as String,
      currentValue = j['currentValue'] as String;

  final String ticker;
  final String organizationName;
  final String currency;
  final String shares;
  final String invested;
  final String currentValue;
}

class Investment {
  Investment.fromJson(Json j)
    : id = j['id'] as String,
      ticker = j['ticker'] as String,
      organizationName = j['organizationName'] as String,
      shares = j['shares'] as String,
      amount = j['amount'] as String,
      currency = j['currency'] as String,
      frozenAmount = j['frozenAmount'] as String,
      unlocksAt = _date(j['unlocksAt']),
      createdAt = _date(j['createdAt']);

  final String id;
  final String ticker;
  final String organizationName;
  final String shares;
  final String amount;
  final String currency;
  final String frozenAmount;
  final DateTime unlocksAt;
  final DateTime createdAt;
}

class Portfolio {
  Portfolio.fromJson(Json j)
    : holdings = _list(j['holdings'], Holding.fromJson),
      investments = _list(j['investments'], Investment.fromJson);

  final List<Holding> holdings;
  final List<Investment> investments;
}

class Message {
  Message.fromJson(Json j)
    : id = j['id'] as int,
      chatId = j['chatId'] as String,
      sender = j['sender'] == null ? null : UserSummary.fromJson(j['sender'] as Json),
      kind = j['kind'] as String,
      body = j['body'] as String,
      meta = (j['meta'] as Json?) ?? {},
      replyToId = j['replyToId'] as int?,
      editedAt = _dateOrNull(j['editedAt']),
      deleted = j['deleted'] as bool? ?? false,
      createdAt = _date(j['createdAt']);

  final int id;
  final String chatId;
  final UserSummary? sender;
  final String kind;
  final String body;
  final Json meta;
  final int? replyToId;
  final DateTime? editedAt;
  final bool deleted;
  final DateTime createdAt;

  bool get isSystem => kind == 'system';
}

class SupportInfo {
  SupportInfo.fromJson(Json j)
    : status = j['status'] as String,
      requester = UserSummary.fromJson(j['requester'] as Json);

  final String status;
  final UserSummary requester;
}

class Chat {
  Chat.fromJson(Json j)
    : id = j['id'] as String,
      type = j['type'] as String,
      title = j['title'] as String,
      description = j['description'] as String? ?? '',
      handle = j['handle'] as String?,
      memberCount = j['memberCount'] as int,
      myRole = j['myRole'] as String?,
      pinned = j['pinned'] as bool? ?? false,
      unreadCount = j['unreadCount'] as int? ?? 0,
      lastMessage = j['lastMessage'] == null ? null : Message.fromJson(j['lastMessage'] as Json),
      peer = j['peer'] == null ? null : UserSummary.fromJson(j['peer'] as Json),
      support = j['support'] == null ? null : SupportInfo.fromJson(j['support'] as Json),
      createdAt = _date(j['createdAt']);

  final String id;
  final String type;
  final String title;
  final String description;
  final String? handle;
  final int memberCount;
  final String? myRole;
  final bool pinned;
  final int unreadCount;
  final Message? lastMessage;
  final UserSummary? peer;
  final SupportInfo? support;
  final DateTime createdAt;

  DateTime get activityAt => lastMessage?.createdAt ?? createdAt;

  /// Channels are read-only for subscribers; everything else accepts messages from members.
  bool get canPost => type != 'channel' || myRole == 'owner' || myRole == 'admin';
}

class ChatMember {
  ChatMember.fromJson(Json j) : user = UserSummary.fromJson(j['user'] as Json), role = j['role'] as String;

  final UserSummary user;
  final String role;
}

class Story {
  Story.fromJson(Json j)
    : id = j['id'] as String,
      author = UserSummary.fromJson(j['author'] as Json),
      text = j['text'] as String,
      linkUrl = j['linkUrl'] as String?,
      background = j['background'] as String,
      viewed = j['viewed'] as bool? ?? false,
      viewsCount = j['viewsCount'] as int? ?? 0,
      createdAt = _date(j['createdAt']);

  final String id;
  final UserSummary author;
  final String text;
  final String? linkUrl;
  final String background;
  final bool viewed;
  final int viewsCount;
  final DateTime createdAt;
}

// ---------------------------------------------------------------------------
// Approval workflows (mirrors packages/shared/src/workflows.ts)
// ---------------------------------------------------------------------------

class ChecklistItem {
  const ChecklistItem(this.key, this.label);
  final String key;
  final String label;
}

class WorkflowStage {
  const WorkflowStage(this.key, this.label, this.description, {this.checklist = const []});
  final String key;
  final String label;
  final String description;
  final List<ChecklistItem> checklist;
}

class Workflow {
  const Workflow(this.label, this.description, this.stages);
  final String label;
  final String description;
  final List<WorkflowStage> stages;
}

const workflows = <String, Workflow>{
  'company': Workflow(
    'Company / business account',
    'Registers a company with its business license in the public registry and (optionally) lists it on the stock exchange.',
    [
      WorkflowStage(
        'moderation',
        'Moderation review',
        'A moderator must confirm they reviewed every part of the company file.',
        checklist: [
          ChecklistItem('identity', 'Applicant identity and contact details'),
          ChecklistItem('company', 'Company name, description and website'),
          ChecklistItem('business_plan', 'Business plan and activity'),
          ChecklistItem('license', 'Requested business license'),
          ChecklistItem('listing', 'Stock listing parameters (ticker, share price, share count)'),
        ],
      ),
      WorkflowStage(
        'approval',
        'Council or administration approval',
        'Approved by the council quorum, or by an admin / the owner.',
      ),
    ],
  ),
  'license': Workflow(
    'License',
    'Virtual licenses (projects, fan-projects, TV / radio channels, websites, virtual countries…). Published to the public registry after all confirmations.',
    [
      WorkflowStage(
        'moderation',
        'Moderation',
        'A moderator checks the request and confirms it is virtual-only.',
        checklist: [
          ChecklistItem('holder', 'License holder'),
          ChecklistItem('content', 'Title, description and supporting links'),
          ChecklistItem('virtual_only', 'The license covers virtual things only (nothing physical)'),
        ],
      ),
      WorkflowStage('council', 'Council vote', 'Council members vote until the quorum is reached.'),
      WorkflowStage(
        'owner',
        'Owner confirmation',
        'Final confirmation by the owner, then rollout to the public registry.',
      ),
    ],
  ),
  'moderator': Workflow(
    'Join the moderation team',
    'Become a moderator: review applications, answer tech support and manage channels.',
    [
      WorkflowStage('council', 'Council vote', 'Council members vote on the candidate.'),
      WorkflowStage('administration', 'Administration confirmation', 'An admin or the owner grants the role.'),
    ],
  ),
  'council': Workflow(
    'Join the council',
    'Become a council member with a vote on companies, licenses and new members.',
    [
      WorkflowStage('council', 'Council vote', 'Current council members vote on the candidate.'),
      WorkflowStage('owner', 'Owner confirmation', 'The owner confirms the new council member.'),
    ],
  ),
  'news_channel': Workflow('News channel', 'News channels can only be created through moderation.', [
    WorkflowStage('moderation', 'Moderation', 'A moderator approves the channel.'),
  ]),
  'renewal': Workflow(
    'Licence renewal',
    'Extends a licence or virtual country for another term. A moderator checks it is still in use.',
    [
      WorkflowStage(
        'moderation',
        'Moderation',
        'A moderator confirms the holder still uses the licence as registered.',
        checklist: [
          ChecklistItem('holder', 'The holder is unchanged and in good standing'),
          ChecklistItem('activity', 'The licence is still used as described in the registry'),
        ],
      ),
    ],
  ),
};

// ---------------------------------------------------------------------------
// Realtime events
// ---------------------------------------------------------------------------

class RealtimeEvent {
  RealtimeEvent.fromJson(Json j)
    : type = j['type'] as String,
      chatId = j['chatId'] as String?,
      message = j['message'] == null ? null : Message.fromJson(j['message'] as Json),
      userId = j['userId'] as String?,
      status = j['status'] as String?;

  final String type;
  final String? chatId;
  final Message? message;
  final String? userId;
  final String? status;
}
