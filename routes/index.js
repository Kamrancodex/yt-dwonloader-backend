const express = require("express");

module.exports = (io) => {
  const router = express.Router();
  const downloadRoutes = require("./DownloadRoutes")(io);

  router.use("/downloads", downloadRoutes);

  return router;
};
