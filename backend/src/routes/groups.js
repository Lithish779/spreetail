import express from 'express';
import { Group, GroupMembership, User } from '../models/index.js';
import { authRequired } from '../middleware/auth.js';
import { Op } from 'sequelize';

const router = express.Router();
router.use(authRequired);

// List groups the current user belongs to (currently or historically)
router.get('/', async (req, res) => {
  const memberships = await GroupMembership.findAll({
    where: { UserId: req.user.id },
    include: [Group],
  });
  const groups = memberships.map((m) => ({
    ...m.Group.toJSON(),
    joinedAt: m.joinedAt,
    leftAt: m.leftAt,
    isCurrentMember: m.leftAt === null,
  }));
  res.json(groups);
});

// Create a new group. Creator becomes the first member.
router.post('/', async (req, res) => {
  const { name, baseCurrency } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const group = await Group.create({ name, baseCurrency: baseCurrency || 'INR' });
  await GroupMembership.create({
    GroupId: group.id,
    UserId: req.user.id,
    joinedAt: new Date().toISOString().slice(0, 10),
    leftAt: null,
  });
  res.status(201).json(group);
});

// Get group details including full membership history
router.get('/:id', async (req, res) => {
  const group = await Group.findByPk(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const memberships = await GroupMembership.findAll({
    where: { GroupId: group.id },
    include: [User],
    order: [['joinedAt', 'ASC']],
  });

  res.json({
    ...group.toJSON(),
    members: memberships.map((m) => ({
      userId: m.UserId,
      name: m.User.name,
      email: m.User.email,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      isCurrentMember: m.leftAt === null,
    })),
  });
});

// Add a member to a group (joins "today" or on a given date)
router.post('/:id/members', async (req, res) => {
  const { userId, email, joinedAt } = req.body;
  const group = await Group.findByPk(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  let user;
  if (userId) {
    user = await User.findByPk(userId);
  } else if (email) {
    user = await User.findOne({ where: { email } });
  }
  if (!user) return res.status(404).json({ error: 'User not found' });

  // If they previously left, re-joining creates a new membership row
  // (so history with leftAt is preserved for past balance calculations)
  const existingOpen = await GroupMembership.findOne({
    where: { GroupId: group.id, UserId: user.id, leftAt: null },
  });
  if (existingOpen) return res.status(409).json({ error: 'User is already a member' });

  const membership = await GroupMembership.create({
    GroupId: group.id,
    UserId: user.id,
    joinedAt: joinedAt || new Date().toISOString().slice(0, 10),
    leftAt: null,
  });
  res.status(201).json(membership);
});

// Mark a member as having left on a given date
router.patch('/:id/members/:userId/leave', async (req, res) => {
  const { leftAt } = req.body;
  const membership = await GroupMembership.findOne({
    where: { GroupId: req.params.id, UserId: req.params.userId, leftAt: null },
  });
  if (!membership) return res.status(404).json({ error: 'Active membership not found' });

  membership.leftAt = leftAt || new Date().toISOString().slice(0, 10);
  await membership.save();
  res.json(membership);
});

// Lightweight: list all users (for "add member" search)
router.get('/_/users', async (req, res) => {
  const users = await User.findAll({ attributes: ['id', 'name', 'email'] });
  res.json(users);
});

export default router;
