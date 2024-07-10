const express = require("express");
const downloadRoutes = require("./DownloadRoutes");

module.exports = (io) => {
  const router = express.Router();
  router.use("/downloads", downloadRoutes(io));
  return router;
};
