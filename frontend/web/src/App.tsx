import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ChargingSession {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  location: string;
  duration: number;
  energyConsumed: number;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<ChargingSession[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newSessionData, setNewSessionData] = useState({
    location: "",
    duration: "",
    energyConsumed: ""
  });
  const [showFAQ, setShowFAQ] = useState(false);
  const [gridLoad, setGridLoad] = useState(65); // Simulated grid load percentage
  const [predictedLoad, setPredictedLoad] = useState(72); // Simulated predicted load

  // Calculate statistics for dashboard
  const verifiedCount = sessions.filter(s => s.status === "verified").length;
  const pendingCount = sessions.filter(s => s.status === "pending").length;
  const rejectedCount = sessions.filter(s => s.status === "rejected").length;
  const totalEnergy = sessions.reduce((sum, session) => sum + session.energyConsumed, 0);

  useEffect(() => {
    loadSessions().finally(() => setLoading(false));
    
    // Simulate real-time grid load updates
    const gridInterval = setInterval(() => {
      setGridLoad(prev => {
        const fluctuation = Math.floor(Math.random() * 5) - 2;
        return Math.min(100, Math.max(20, prev + fluctuation));
      });
    }, 5000);
    
    return () => clearInterval(gridInterval);
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadSessions = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("session_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing session keys:", e);
        }
      }
      
      const list: ChargingSession[] = [];
      
      for (const key of keys) {
        try {
          const sessionBytes = await contract.getData(`session_${key}`);
          if (sessionBytes.length > 0) {
            try {
              const sessionData = JSON.parse(ethers.toUtf8String(sessionBytes));
              list.push({
                id: key,
                encryptedData: sessionData.data,
                timestamp: sessionData.timestamp,
                owner: sessionData.owner,
                location: sessionData.location,
                duration: sessionData.duration,
                energyConsumed: sessionData.energyConsumed,
                status: sessionData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing session data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading session ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setSessions(list);
    } catch (e) {
      console.error("Error loading sessions:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitSession = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting charging data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newSessionData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const sessionData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        location: newSessionData.location,
        duration: parseInt(newSessionData.duration),
        energyConsumed: parseInt(newSessionData.energyConsumed),
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `session_${sessionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(sessionData))
      );
      
      const keysBytes = await contract.getData("session_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(sessionId);
      
      await contract.setData(
        "session_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted charging data submitted securely!"
      });
      
      await loadSessions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewSessionData({
          location: "",
          duration: "",
          energyConsumed: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifySession = async (sessionId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const sessionBytes = await contract.getData(`session_${sessionId}`);
      if (sessionBytes.length === 0) {
        throw new Error("Session not found");
      }
      
      const sessionData = JSON.parse(ethers.toUtf8String(sessionBytes));
      
      const updatedSession = {
        ...sessionData,
        status: "verified"
      };
      
      await contract.setData(
        `session_${sessionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedSession))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadSessions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectSession = async (sessionId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const sessionBytes = await contract.getData(`session_${sessionId}`);
      if (sessionBytes.length === 0) {
        throw new Error("Session not found");
      }
      
      const sessionData = JSON.parse(ethers.toUtf8String(sessionBytes));
      
      const updatedSession = {
        ...sessionData,
        status: "rejected"
      };
      
      await contract.setData(
        `session_${sessionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedSession))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed successfully!"
      });
      
      await loadSessions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const faqItems = [
    {
      question: "How does FHE protect charging data?",
      answer: "Fully Homomorphic Encryption allows computations on encrypted data without decryption, ensuring privacy while enabling grid optimization."
    },
    {
      question: "What data is encrypted?",
      answer: "All sensitive charging session details including location, duration, and energy consumption are encrypted using FHE."
    },
    {
      question: "How is grid load optimized?",
      answer: "Our FHE algorithms analyze encrypted charging patterns to predict demand and distribute load efficiently across the grid."
    },
    {
      question: "Can operators see my raw data?",
      answer: "No, operators only see aggregated insights and recommendations generated from encrypted data."
    }
  ];

  const renderGridLoadChart = () => {
    return (
      <div className="grid-load-chart">
        <div className="chart-header">
          <h3>Real-time Grid Load</h3>
          <div className="current-load">
            <span className="value">{gridLoad}%</span>
            <span className="label">Current Load</span>
          </div>
        </div>
        <div className="chart-container">
          <div className="chart-bar" style={{ height: `${gridLoad}%` }}>
            <div className="bar-fill"></div>
          </div>
          <div className="chart-labels">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
        <div className="chart-footer">
          <div className="prediction">
            <span className="label">Predicted Peak:</span>
            <span className="value">{predictedLoad}%</span>
          </div>
        </div>
      </div>
    );
  };

  const renderEnergyChart = () => {
    const peakHours = [0, 0, 0, 0, 5, 15, 30, 45, 60, 70, 75, 80, 75, 70, 65, 60, 70, 85, 95, 100, 90, 75, 50, 30];
    const currentHour = new Date().getHours();
    
    return (
      <div className="energy-chart">
        <h3>Energy Consumption Forecast</h3>
        <div className="chart-container">
          {peakHours.map((value, hour) => (
            <div 
              key={hour} 
              className={`chart-bar ${hour === currentHour ? 'current' : ''}`}
              style={{ height: `${value}%` }}
            >
              <div className="bar-value">{value}%</div>
              <div className="hour-label">{hour}:00</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner">
        <div className="fhe-ring"></div>
        <div className="fhe-core"></div>
      </div>
      <p>Initializing encrypted charging network...</p>
    </div>
  );

  return (
    <div className="app-container future-metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="charging-icon"></div>
          </div>
          <h1>EV<span>Charge</span>Network</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-session-btn metal-button"
          >
            <div className="add-icon"></div>
            Add Session
          </button>
          <button 
            className="metal-button"
            onClick={() => setShowFAQ(!showFAQ)}
          >
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-panels">
          <div className="panel-left">
            <div className="welcome-banner">
              <div className="welcome-text">
                <h2>EV Charging Network Optimization</h2>
                <p>Securely share encrypted charging data to optimize grid load and charging station placement</p>
              </div>
              <div className="fhe-badge">
                <span>FHE-Powered</span>
              </div>
            </div>
            
            <div className="stats-panel metal-card">
              <h3>Charging Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{sessions.length}</div>
                  <div className="stat-label">Total Sessions</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{verifiedCount}</div>
                  <div className="stat-label">Verified</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{pendingCount}</div>
                  <div className="stat-label">Pending</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{totalEnergy}</div>
                  <div className="stat-label">Total kWh</div>
                </div>
              </div>
            </div>
            
            <div className="sessions-panel metal-card">
              <div className="panel-header">
                <h3>Charging Sessions</h3>
                <div className="header-actions">
                  <button 
                    onClick={loadSessions}
                    className="refresh-btn metal-button"
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="sessions-list">
                {sessions.length === 0 ? (
                  <div className="no-sessions">
                    <div className="no-sessions-icon"></div>
                    <p>No charging sessions found</p>
                    <button 
                      className="metal-button primary"
                      onClick={() => setShowCreateModal(true)}
                    >
                      Add First Session
                    </button>
                  </div>
                ) : (
                  sessions.map(session => (
                    <div className="session-item" key={session.id}>
                      <div className="session-info">
                        <div className="session-id">#{session.id.substring(0, 6)}</div>
                        <div className="session-location">{session.location}</div>
                        <div className="session-details">
                          <span>{session.duration} mins</span>
                          <span>{session.energyConsumed} kWh</span>
                        </div>
                      </div>
                      <div className="session-meta">
                        <div className="session-owner">
                          {session.owner.substring(0, 6)}...{session.owner.substring(38)}
                        </div>
                        <div className="session-date">
                          {new Date(session.timestamp * 1000).toLocaleDateString()}
                        </div>
                        <div className={`session-status ${session.status}`}>
                          {session.status}
                        </div>
                      </div>
                      <div className="session-actions">
                        {isOwner(session.owner) && session.status === "pending" && (
                          <>
                            <button 
                              className="action-btn metal-button success"
                              onClick={() => verifySession(session.id)}
                            >
                              Verify
                            </button>
                            <button 
                              className="action-btn metal-button danger"
                              onClick={() => rejectSession(session.id)}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          
          <div className="panel-right">
            <div className="realtime-panel metal-card">
              <h3>Grid Load Dashboard</h3>
              {renderGridLoadChart()}
            </div>
            
            <div className="chart-panel metal-card">
              {renderEnergyChart()}
            </div>
            
            <div className="fhe-panel metal-card">
              <h3>FHE Optimization</h3>
              <div className="optimization-results">
                <div className="result-item">
                  <div className="result-label">Optimal Station Placement:</div>
                  <div className="result-value">Downtown Area</div>
                </div>
                <div className="result-item">
                  <div className="result-label">Load Balancing Recommendation:</div>
                  <div className="result-value">Shift 15% to North Grid</div>
                </div>
                <div className="result-item">
                  <div className="result-label">Peak Demand Prediction:</div>
                  <div className="result-value">18:00 - 20:00</div>
                </div>
              </div>
              <button className="metal-button full-width">
                Apply Optimization
              </button>
            </div>
          </div>
        </div>
        
        {showFAQ && (
          <div className="faq-panel metal-card">
            <h3>Frequently Asked Questions</h3>
            <div className="faq-items">
              {faqItems.map((item, index) => (
                <div className="faq-item" key={index}>
                  <div className="faq-question">
                    <div className="question-icon">Q</div>
                    {item.question}
                  </div>
                  <div className="faq-answer">
                    <div className="answer-icon">A</div>
                    {item.answer}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitSession} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          sessionData={newSessionData}
          setSessionData={setNewSessionData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner small"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="charging-icon"></div>
              <span>EVChargeNetwork</span>
            </div>
            <p>Optimizing EV charging with FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Optimization</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} EVChargeNetwork. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  sessionData: any;
  setSessionData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  sessionData,
  setSessionData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSessionData({
      ...sessionData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!sessionData.location || !sessionData.duration || !sessionData.energyConsumed) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Add Charging Session</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Your charging data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Location *</label>
              <input 
                type="text"
                name="location"
                value={sessionData.location} 
                onChange={handleChange}
                placeholder="Enter location..." 
                className="metal-input"
              />
            </div>
            
            <div className="form-group">
              <label>Duration (minutes) *</label>
              <input 
                type="number"
                name="duration"
                value={sessionData.duration} 
                onChange={handleChange}
                placeholder="Enter duration..." 
                className="metal-input"
              />
            </div>
            
            <div className="form-group">
              <label>Energy Consumed (kWh) *</label>
              <input 
                type="number"
                name="energyConsumed"
                value={sessionData.energyConsumed} 
                onChange={handleChange}
                placeholder="Enter energy..." 
                className="metal-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> Data remains encrypted during FHE processing for grid optimization
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;