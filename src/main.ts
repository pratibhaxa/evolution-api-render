import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.SERVER_PORT || 8080;
const SECRET = process.env.SECRET_KEY || "default";

app.get("/", (_req, res) => {
  res.json({
    status: "Evolution API running on Render",
    port: PORT
  });
});

app.listen(PORT, () => {
  console.log(`⚡ Evolution API running on port ${PORT}`);
});
