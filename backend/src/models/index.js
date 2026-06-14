import { Sequelize, DataTypes } from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: process.env.SQLITE_STORAGE || path.join(__dirname, '../../data/expenses.sqlite'),
  logging: false,
});

// ---------- User ----------
export const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
});

// ---------- Group ----------
export const Group = sequelize.define('Group', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  baseCurrency: { type: DataTypes.STRING, defaultValue: 'INR' },
});

// ---------- GroupMembership (join table with time-bounded membership) ----------
// A user can join and leave a group; leaving doesn't delete the row,
// it sets leftAt. This lets us answer "was X a member on date D?"
export const GroupMembership = sequelize.define('GroupMembership', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  joinedAt: { type: DataTypes.DATEONLY, allowNull: false },
  leftAt: { type: DataTypes.DATEONLY, allowNull: true }, // null = still a member
});

// ---------- Expense ----------
// Stores the amount in BOTH original currency and converted base currency.
// originalAmount/originalCurrency preserve what was actually paid (Priya's concern).
// amountBase/exchangeRate record the conversion used for balance calculations.
export const Expense = sequelize.define('Expense', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  description: { type: DataTypes.STRING, allowNull: false },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  originalAmount: { type: DataTypes.FLOAT, allowNull: false },
  originalCurrency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'INR' },
  exchangeRate: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 1 }, // to baseCurrency
  amountBase: { type: DataTypes.FLOAT, allowNull: false }, // originalAmount * exchangeRate, rounded to 2dp
  splitType: {
    type: DataTypes.ENUM('equal', 'unequal', 'percentage', 'share'),
    allowNull: false,
  },
  isRefund: { type: DataTypes.BOOLEAN, defaultValue: false }, // negative-amount rows flagged as refunds
  notes: { type: DataTypes.STRING, allowNull: true },
  // Provenance: was this created via CSV import or manually?
  source: { type: DataTypes.ENUM('manual', 'import'), defaultValue: 'manual' },
  importBatchId: { type: DataTypes.INTEGER, allowNull: true },
});

// ---------- ExpenseShare ----------
// One row per (expense, person) describing how much of the BASE-CURRENCY
// amount that person owes for this expense. Computed once at creation time
// from splitType + splitDetails so balance calc is just a SUM query
// (Rohan's "no magic numbers" requirement: each share is traceable to a row).
export const ExpenseShare = sequelize.define('ExpenseShare', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  shareAmount: { type: DataTypes.FLOAT, allowNull: false }, // in base currency
  rawShareValue: { type: DataTypes.FLOAT, allowNull: true }, // % or share-units, for display
});

// ---------- Payment / Settlement ----------
// Records money transferred between members to settle balances.
// "Rohan paid Aisha back" type rows from the CSV land here, NOT in Expense.
export const Payment = sequelize.define('Payment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  amount: { type: DataTypes.FLOAT, allowNull: false }, // in group base currency
  originalAmount: { type: DataTypes.FLOAT, allowNull: true },
  originalCurrency: { type: DataTypes.STRING, allowNull: true },
  notes: { type: DataTypes.STRING, allowNull: true },
  source: { type: DataTypes.ENUM('manual', 'import'), defaultValue: 'manual' },
  importBatchId: { type: DataTypes.INTEGER, allowNull: true },
});

// ---------- ImportBatch ----------
// One row per CSV import run. Holds the generated report as JSON so it can
// be re-displayed later, and supports Meera's "approve before applying" flow.
export const ImportBatch = sequelize.define('ImportBatch', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  filename: { type: DataTypes.STRING, allowNull: false },
  status: {
    type: DataTypes.ENUM('pending_review', 'applied', 'rejected'),
    defaultValue: 'pending_review',
  },
  reportJson: { type: DataTypes.TEXT, allowNull: false }, // full anomaly report
});

// ================= Associations =================

User.belongsToMany(Group, { through: GroupMembership });
Group.belongsToMany(User, { through: GroupMembership });
GroupMembership.belongsTo(User);
GroupMembership.belongsTo(Group);
User.hasMany(GroupMembership);
Group.hasMany(GroupMembership);

Group.hasMany(Expense, { onDelete: 'CASCADE' });
Expense.belongsTo(Group);

Expense.belongsTo(User, { as: 'paidBy', foreignKey: 'paidByUserId' });
User.hasMany(Expense, { as: 'expensesPaid', foreignKey: 'paidByUserId' });

Expense.hasMany(ExpenseShare, { onDelete: 'CASCADE' });
ExpenseShare.belongsTo(Expense);

ExpenseShare.belongsTo(User);
User.hasMany(ExpenseShare);

Group.hasMany(Payment, { onDelete: 'CASCADE' });
Payment.belongsTo(Group);

Payment.belongsTo(User, { as: 'fromUser', foreignKey: 'fromUserId' });
Payment.belongsTo(User, { as: 'toUser', foreignKey: 'toUserId' });

Group.hasMany(ImportBatch, { onDelete: 'CASCADE' });
ImportBatch.belongsTo(Group);

export default sequelize;
