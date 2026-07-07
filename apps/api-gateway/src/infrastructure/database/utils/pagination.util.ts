export const getPagination = (
  page = 1,

  limit = 20,
) => {
  const safePage = Math.max(page, 1);

  const safeLimit = Math.min(limit, 100);

  return {
    skip: (safePage - 1) * safeLimit,

    take: safeLimit,
  };
};
