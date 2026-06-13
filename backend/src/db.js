import { sequelize } from './models/index.js';

export async function initDb() {
  await sequelize.sync(); // creates tables if not exist
  console.log('Database synced');
}
