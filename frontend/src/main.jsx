import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { Web3Provider } from "./context/Web3";
import { ToastProvider } from "./context/Toast";
import { TxProvider } from "./context/Tx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <Web3Provider>
          <TxProvider>
            <App />
          </TxProvider>
        </Web3Provider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
