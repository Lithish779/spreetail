import express from 'express';
import multer from 'multer';
import {
  Group, GroupMembership, User, Expense, ExpenseShare, Payment, ImportBatch, sequelize,
} from '../models/index.js';
import { authRequired } from '../middleware/auth.js';
import { parseAndAnalyzeCsv, KNOWN_GROUP_MEMBERS } from '../utils/csvImporter.js';
import { computeShares } from '../utils/splitCalculator.js';
import { Op } from 'sequelize';

const router = express.Router();
router.use(authRequired);
const upload = multer({ storage: multer.memoryStorage() });

// STEP 1: Upload + analyze. Does NOT write expenses/payments yet.
// Stores the report + processed rows on an ImportBatch with status 'pending_review'.
// This is Meera's "approve before applying" requirement.
router.post('/group/:groupId/preview', upload.single('file'), async (req, res) => {
  const groupId = req.params.groupId;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const csvText = req.file.buffer.toString('utf-8');
  const { processed, report } = parseAndAnalyzeCsv(csvText, KNOWN_GROUP_MEMBERS);

  const batch = await ImportBatch.create({
    GroupId: groupId,
    filename: req.file.originalname,
    status: 'pending_review',
    reportJson: JSON.stringify({ processed, report }),
  });

  res.json({
    batchId: batch.id,
    summary: {
      totalRows: processed.length,
      toImport: processed.filter((p) => p.action === 'imported').length,
      toRecordAsPayment: processed.filter((p) => p.action === 'recorded_as_payment').length,
      skipped: processed.filter((p) => p.skip).length,
      flaggedForReview: report.filter((r) => r.action === 'flagged_for_review').length,
    },
    report,
  });
});

// STEP 2: Approve and apply a previously previewed batch.
// Creates real Expense/ExpenseShare/Payment rows in a transaction.
router.post('/batch/:batchId/apply', async (req, res) => {
  const batch = await ImportBatch.findByPk(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (batch.status !== 'pending_review') {
    return res.status(409).json({ error: `Batch already ${batch.status}` });
  }

  const { processed, report } = JSON.parse(batch.reportJson);
  const groupId = batch.GroupId;

  // Build name -> userId map from group members (current + historical)
  const memberships = await GroupMembership.findAll({
    where: { GroupId: groupId },
    include: [User],
  });
  const nameToUserId = {};
  for (const m of memberships) nameToUserId[m.User.name] = m.UserId;

  const created = { expenses: 0, payments: 0, skipped: 0, errors: [] };

  await sequelize.transaction(async (t) => {
    for (const row of processed) {
      if (row.skip) {
        created.skipped++;
        continue;
      }
      const n = row.normalized;
      const payerUserId = nameToUserId[n.paidByName];
      if (!payerUserId) {
        created.errors.push(`Row ${row.rowNum}: payer "${n.paidByName}" not found in group members - skipped.`);
        continue;
      }

      if (n.isSettlement) {
        // Recorded as Payment. For "Rohan paid Aisha back": fromUser = payer (Rohan), toUser = the
        // single name in split_with (Aisha). amount in base currency.
        const toName = n.participantNames[0];
        const toUserId = nameToUserId[toName];
        if (!toUserId) {
          created.errors.push(`Row ${row.rowNum}: payment recipient "${toName}" not found - skipped.`);
          continue;
        }
        const amountBase = Math.round(Math.abs(n.amount) * n.exchangeRate * 100) / 100;
        await Payment.create({
          GroupId: groupId,
          fromUserId: payerUserId,
          toUserId,
          amount: amountBase,
          originalAmount: n.amount,
          originalCurrency: n.currency,
          date: n.date,
          notes: n.notes,
          source: 'import',
          importBatchId: batch.id,
        }, { transaction: t });
        created.payments++;
        continue;
      }

      // Regular expense
      const amountBase = Math.round(Math.abs(n.amount) * n.exchangeRate * 100) / 100;
      const amountForSplit = n.isRefund ? -amountBase : amountBase;

      // Resolve participants to userIds; drop any name not in nameToUserId (already
      // filtered for unknown/stale members during analysis, but double-check here)
      const participants = [];
      for (const name of n.participantNames) {
        if (nameToUserId[name]) participants.push({ userId: nameToUserId[name], name });
      }
      if (participants.length === 0) {
        created.errors.push(`Row ${row.rowNum}: no valid participants - skipped.`);
        continue;
      }

      let shares;
      try {
        shares = computeShares(amountForSplit, n.splitType, participants, n.splitDetails);
      } catch (e) {
        created.errors.push(`Row ${row.rowNum}: ${e.message} - skipped.`);
        continue;
      }

      const expense = await Expense.create({
        GroupId: groupId,
        description: n.description,
        date: n.date,
        originalAmount: n.amount,
        originalCurrency: n.currency,
        exchangeRate: n.exchangeRate,
        amountBase: amountForSplit,
        splitType: n.splitType,
        isRefund: n.isRefund,
        notes: n.notes,
        paidByUserId: payerUserId,
        source: 'import',
        importBatchId: batch.id,
      }, { transaction: t });

      for (const s of shares) {
        await ExpenseShare.create({
          ExpenseId: expense.id,
          UserId: s.userId,
          shareAmount: s.shareAmount,
          rawShareValue: s.rawShareValue,
        }, { transaction: t });
      }
      created.expenses++;
    }

    batch.status = 'applied';
    await batch.save({ transaction: t });
  });

  res.json({ status: 'applied', created, report });
});

// Reject a pending batch (Meera says no)
router.post('/batch/:batchId/reject', async (req, res) => {
  const batch = await ImportBatch.findByPk(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  batch.status = 'rejected';
  await batch.save();
  res.json({ status: 'rejected' });
});

// Get a previously generated import report (for re-display)
router.get('/batch/:batchId', async (req, res) => {
  const batch = await ImportBatch.findByPk(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  const { report, processed } = JSON.parse(batch.reportJson);
  res.json({ id: batch.id, filename: batch.filename, status: batch.status, report, processed });
});

router.get('/group/:groupId/batches', async (req, res) => {
  const batches = await ImportBatch.findAll({
    where: { GroupId: req.params.groupId },
    attributes: ['id', 'filename', 'status', 'createdAt'],
    order: [['createdAt', 'DESC']],
  });
  res.json(batches);
});

export default router;
