import express from 'express';
import { Expense, ExpenseShare, Group, GroupMembership, User, Payment, sequelize } from '../models/index.js';
import { authRequired } from '../middleware/auth.js';
import { computeShares } from '../utils/splitCalculator.js';
import { Op } from 'sequelize';

const router = express.Router();
router.use(authRequired);

// --- helpers ---

async function getMembersAtDate(groupId, date) {
  // Members whose membership window covers `date`: joinedAt <= date AND (leftAt is null OR leftAt > date)
  const memberships = await GroupMembership.findAll({
    where: {
      GroupId: groupId,
      joinedAt: { [Op.lte]: date },
      [Op.or]: [{ leftAt: null }, { leftAt: { [Op.gt]: date } }],
    },
    include: [User],
  });
  return memberships.map((m) => ({ userId: m.UserId, name: m.User.name }));
}

async function getUserByName(name) {
  // Case-insensitive, trims whitespace - used for CSV imports with messy names
  return User.findOne({
    where: sequelize.where(
      sequelize.fn('lower', sequelize.fn('trim', sequelize.col('name'))),
      name.trim().toLowerCase()
    ),
  });
}

// --- routes ---

// List expenses for a group (with shares)
router.get('/group/:groupId', async (req, res) => {
  const expenses = await Expense.findAll({
    where: { GroupId: req.params.groupId },
    include: [
      { model: User, as: 'paidBy', attributes: ['id', 'name'] },
      { model: ExpenseShare, include: [{ model: User, attributes: ['id', 'name'] }] },
    ],
    order: [['date', 'DESC'], ['id', 'DESC']],
  });
  res.json(expenses);
});

// Create a manual expense
router.post('/', async (req, res) => {
  const {
    groupId,
    description,
    date,
    originalAmount,
    originalCurrency,
    exchangeRate,
    paidByUserId,
    splitType,
    participantUserIds, // array of userIds for equal split
    splitDetails, // { [userId]: value } for unequal/percentage/share
    notes,
  } = req.body;

  if (!groupId || !description || !date || !originalAmount || !paidByUserId || !splitType) {
    return res.status(400).json({ error: 'Missing required expense fields' });
  }
  if (originalAmount === 0) {
    return res.status(400).json({ error: 'Amount cannot be zero' });
  }

  const rate = exchangeRate || 1;
  const amountBase = Math.round(Math.abs(originalAmount) * rate * 100) / 100;
  const isRefund = originalAmount < 0;

  // Resolve participants
  let participants;
  if (splitType === 'equal') {
    if (!participantUserIds?.length) {
      return res.status(400).json({ error: 'participantUserIds required for equal split' });
    }
    const users = await User.findAll({ where: { id: participantUserIds } });
    participants = users.map((u) => ({ userId: u.id, name: u.name }));
  } else {
    const ids = Object.keys(splitDetails || {});
    if (!ids.length) return res.status(400).json({ error: 'splitDetails required' });
    const users = await User.findAll({ where: { id: ids } });
    participants = users.map((u) => ({ userId: u.id, name: u.name }));
  }

  // splitDetails keyed by name for computeShares (it works on names)
  let detailsByName = null;
  if (splitDetails) {
    detailsByName = {};
    for (const p of participants) {
      detailsByName[p.name] = splitDetails[p.userId];
    }
  }

  const amountForSplit = isRefund ? -amountBase : amountBase;
  const shares = computeShares(amountForSplit, splitType, participants, detailsByName);

  const expense = await Expense.create({
    GroupId: groupId,
    description,
    date,
    originalAmount,
    originalCurrency: originalCurrency || 'INR',
    exchangeRate: rate,
    amountBase: isRefund ? -amountBase : amountBase,
    splitType,
    isRefund,
    notes,
    paidByUserId,
    source: 'manual',
  });

  for (const s of shares) {
    await ExpenseShare.create({
      ExpenseId: expense.id,
      UserId: s.userId,
      shareAmount: s.shareAmount,
      rawShareValue: s.rawShareValue,
    });
  }

  res.status(201).json({ expense, shares });
});

// Delete an expense
router.delete('/:id', async (req, res) => {
  const expense = await Expense.findByPk(req.params.id);
  if (!expense) return res.status(404).json({ error: 'Not found' });
  await expense.destroy();
  res.json({ ok: true });
});

// --- Balances ---

// Group-wise net balances: for each member, net = (amount they paid that others owe them)
// minus (their share of expenses paid by others) plus/minus settlements.
// Returns simplified "who owes whom" + per-member detail with line-item traceability.
router.get('/group/:groupId/balances', async (req, res) => {
  const groupId = req.params.groupId;

  const expenses = await Expense.findAll({
    where: { GroupId: groupId },
    include: [
      { model: User, as: 'paidBy', attributes: ['id', 'name'] },
      { model: ExpenseShare, include: [{ model: User, attributes: ['id', 'name'] }] },
    ],
  });

  const payments = await Payment.findAll({
    where: { GroupId: groupId },
    include: [
      { model: User, as: 'fromUser', attributes: ['id', 'name'] },
      { model: User, as: 'toUser', attributes: ['id', 'name'] },
    ],
  });

  // net[userId] = how much the group owes this user (positive) or this user owes the group (negative)
  const net = {}; // userId -> { name, net, lines: [...] }

  function ensure(userId, name) {
    if (!net[userId]) net[userId] = { userId, name, net: 0, lines: [] };
  }

  for (const exp of expenses) {
    ensure(exp.paidByUserId, exp.paidBy.name);
    // Payer is owed the full amount (they fronted the money)
    net[exp.paidByUserId].net += exp.amountBase;
    net[exp.paidByUserId].lines.push({
      type: 'paid',
      expenseId: exp.id,
      description: exp.description,
      date: exp.date,
      amount: exp.amountBase,
    });

    // Each participant owes their share (including the payer themselves, which nets out)
    for (const share of exp.ExpenseShares) {
      ensure(share.UserId, share.User.name);
      net[share.UserId].net -= share.shareAmount;
      net[share.UserId].lines.push({
        type: 'share',
        expenseId: exp.id,
        description: exp.description,
        date: exp.date,
        amount: -share.shareAmount,
      });
    }
  }

  for (const pay of payments) {
    ensure(pay.fromUserId, pay.fromUser.name);
    ensure(pay.toUserId, pay.toUser.name);
    // fromUser paid toUser -> fromUser's debt decreases (net increases), toUser's credit decreases (net decreases)
    net[pay.fromUserId].net += pay.amount;
    net[pay.fromUserId].lines.push({
      type: 'payment_sent',
      paymentId: pay.id,
      description: `Payment to ${pay.toUser.name}`,
      date: pay.date,
      amount: pay.amount,
    });
    net[pay.toUserId].net -= pay.amount;
    net[pay.toUserId].lines.push({
      type: 'payment_received',
      paymentId: pay.id,
      description: `Payment from ${pay.fromUser.name}`,
      date: pay.date,
      amount: -pay.amount,
    });
  }

  // Round nets
  for (const k of Object.keys(net)) {
    net[k].net = Math.round(net[k].net * 100) / 100;
  }

  // Simplify into "who owes whom" using greedy settlement
  const debtors = []; // net < 0, they owe money
  const creditors = []; // net > 0, they are owed money
  for (const v of Object.values(net)) {
    if (v.net < -0.005) debtors.push({ userId: v.userId, name: v.name, amount: -v.net });
    else if (v.net > 0.005) creditors.push({ userId: v.userId, name: v.name, amount: v.net });
  }
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i], c = creditors[j];
    const amt = Math.round(Math.min(d.amount, c.amount) * 100) / 100;
    if (amt > 0.005) {
      settlements.push({ from: d.name, fromUserId: d.userId, to: c.name, toUserId: c.userId, amount: amt });
    }
    d.amount = Math.round((d.amount - amt) * 100) / 100;
    c.amount = Math.round((c.amount - amt) * 100) / 100;
    if (d.amount <= 0.005) i++;
    if (c.amount <= 0.005) j++;
  }

  res.json({
    members: Object.values(net),
    settlements, // Aisha's "one number per person, who pays whom"
  });
});

// --- Payments / Settlements ---

router.post('/payments', async (req, res) => {
  const { groupId, fromUserId, toUserId, amount, date, notes } = req.body;
  if (!groupId || !fromUserId || !toUserId || !amount || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const payment = await Payment.create({
    GroupId: groupId,
    fromUserId,
    toUserId,
    amount,
    date,
    notes,
    source: 'manual',
  });
  res.status(201).json(payment);
});

router.get('/group/:groupId/payments', async (req, res) => {
  const payments = await Payment.findAll({
    where: { GroupId: req.params.groupId },
    include: [
      { model: User, as: 'fromUser', attributes: ['id', 'name'] },
      { model: User, as: 'toUser', attributes: ['id', 'name'] },
    ],
    order: [['date', 'DESC']],
  });
  res.json(payments);
});

export default router;
