// Test environment setup
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://mindvault:mindvault_dev_password@localhost:5433/mindvault?schema=public&connection_limit=25&pool_timeout=60';
process.env.DIRECT_URL = process.env.DATABASE_URL;
