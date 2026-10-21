// Las pruebas corren contra SQLite en memoria: no tocan el MySQL local ni Cloudinary.
process.env.NODE_ENV = 'test';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';
process.env.JWT_SECRET = 'secreto-de-pruebas-1234567890';
process.env.CLOUDINARY_URL = 'cloudinary://key:secret@demo';
