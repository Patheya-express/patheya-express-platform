export default () => ({
    app: {
      port: parseInt(process.env.PORT || '3000', 10),
      nodeEnv: process.env.NODE_ENV,
    },
  
    database: {
      url: process.env.DATABASE_URL,
    },
  
    redis: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
  
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET,
      refreshSecret: process.env.JWT_REFRESH_SECRET,
    },
  
    kafka: {
      broker: process.env.KAFKA_BROKER,
    },
  });