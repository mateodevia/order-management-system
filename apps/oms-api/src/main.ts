import 'express-async-errors';
import { app } from './app';

const PORT = process.env['PORT'] ?? 3000;

app.listen(PORT, () => {
  console.log(`OMS API listening on port ${PORT}`);
});
