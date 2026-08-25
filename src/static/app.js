/*
Zava Clothing Concept Analyzer - React Application

This application provides a modern, real-time interface for Zava's
clothing concept evaluation workflow, enabling fashion teams to
analyze new design submissions through AI-powered analysis.
*/

const { useState, useEffect, useRef } = React;

/**
 * Main application component for Zava Clothing Concept Analyzer
 *
 * Manages the complete workflow from concept upload through team approval,
 * providing real-time updates via WebSocket connection.
 */
function ZavaConceptAnalyzer() {
    // ===== APPLICATION STATE =====

    // File upload and workflow state
    const [uploadedFile, setUploadedFile] = useState(null);
    const [analysisStatus, setAnalysisStatus] = useState({
        status: 'ready',
        progress: 0,
        current_step: 'Ready to analyze clothing concepts',
        steps: [],
        outputs: [],
        approval_request: null,
        error: null
    });

    // UI interaction state
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [approvalFeedback, setApprovalFeedback] = useState('');
    const [finalResults, setFinalResults] = useState(null);

    // WebSocket connection state
    const [connectionStatus, setConnectionStatus] = useState('connecting');
    const websocketRef = useRef(null);
    const fileInputRef = useRef(null);

    // ===== WEBSOCKET CONNECTION MANAGEMENT =====

    useEffect(() => {
        connectWebSocket();

        // Cleanup on component unmount
        return () => {
            if (websocketRef.current) {
                websocketRef.current.close();
            }
        };
    }, []);

    /**
     * Establish WebSocket connection for real-time updates
     * Handles reconnection logic and message routing
     */
    const connectWebSocket = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        try {
            websocketRef.current = new WebSocket(wsUrl);

            websocketRef.current.onopen = () => {
                console.log('🔗 WebSocket connected to Zava analysis system');
                setConnectionStatus('connected');
            };

            websocketRef.current.onmessage = (event) => {
                handleWebSocketMessage(JSON.parse(event.data));
            };

            websocketRef.current.onclose = () => {
                console.log('🔌 WebSocket connection closed');
                setConnectionStatus('disconnected');

                // Auto-reconnect after 3 seconds
                setTimeout(() => {
                    if (connectionStatus !== 'connected') {
                        connectWebSocket();
                    }
                }, 3000);
            };

            websocketRef.current.onerror = (error) => {
                console.error('WebSocket error:', error);
                setConnectionStatus('disconnected');
            };

        } catch (error) {
            console.error('WebSocket connection failed:', error);
            setConnectionStatus('disconnected');
        }
    };

    /**
     * Process incoming WebSocket messages and update application state
     */
    const handleWebSocketMessage = (message) => {
        switch (message.type) {
            case 'status_update':
            case 'progress_update':
                setAnalysisStatus(message.status);
                break;

            case 'output_added':
                // Real-time analysis outputs (agent results, system messages, etc.)
                setAnalysisStatus(prev => ({
                    ...prev,
                    outputs: [...prev.outputs, message.output]
                }));
                break;

            case 'approval_request':
                // Human approval needed for concept decision
                setAnalysisStatus(prev => ({
                    ...prev,
                    status: 'waiting_approval',
                    approval_request: {
                        question: message.question,
                        context: message.context,
                        timestamp: new Date().toISOString()
                    }
                }));
                break;

            case 'workflow_completed':
                // Analysis complete with final results
                setIsAnalyzing(false);
                setFinalResults({
                    result: message.result,
                    document: message.finalDocument,
                    filename: message.filename
                });
                setAnalysisStatus(prev => ({
                    ...prev,
                    status: 'completed',
                    progress: 100
                }));
                break;

            case 'error':
                // Handle workflow errors
                console.error('🚨 Analysis error:', message.error);
                setAnalysisStatus(prev => ({
                    ...prev,
                    status: 'error',
                    error: message.error
                }));
                setIsAnalyzing(false);
                break;

            default:
                console.log('📨 Unknown message type:', message.type);
        }
    };

    // ===== FILE UPLOAD HANDLING =====

    /**
     * Handle clothing concept file upload
     * Validates file format and uploads to server
     */
    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Validate PowerPoint format for concept pitches
        if (!file.name.toLowerCase().endsWith('.pptx')) {
            alert('📋 Please upload a PowerPoint (.pptx) file containing your clothing concept pitch.');
            return;
        }

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/upload-concept', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Upload failed');
            }

            const result = await response.json();
            setUploadedFile({
                name: file.name,
                size: file.size,
                tempPath: result.temp_path
            });

            console.log('Concept file uploaded successfully:', result);

        } catch (error) {
            console.error('Upload failed:', error);
            alert(`Upload failed: ${error.message}`);
        }
    };

    /**
     * Start the comprehensive fashion analysis workflow
     */
    const startAnalysis = async () => {
        if (!uploadedFile) {
            alert('📋 Please upload a clothing concept file first.');
            return;
        }

        try {
            setIsAnalyzing(true);
            setFinalResults(null);
            setApprovalFeedback('');

            const response = await fetch(`/start-analysis/${encodeURIComponent(uploadedFile.tempPath)}`, {
                method: 'POST'
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Analysis startup failed');
            }

            console.log('🎨 Started Zava fashion analysis workflow');

        } catch (error) {
            console.error('Analysis startup failed:', error);
            alert(`Analysis failed to start: ${error.message}`);
            setIsAnalyzing(false);
        }
    };

    // ===== APPROVAL WORKFLOW HANDLING =====

    /**
     * Submit team approval decision to the workflow
     */
    const submitApproval = async (decision) => {
        try {
            const response = await fetch('/submit-approval', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    decision: decision,
                    feedback: approvalFeedback.trim()
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Approval submission failed');
            }

            console.log(`Team decision submitted: ${decision.toUpperCase()}`);
            setApprovalFeedback('');

        } catch (error) {
            console.error('Approval submission failed:', error);
            alert(`Failed to submit approval: ${error.message}`);
        }
    };

    // ===== UTILITY FUNCTIONS =====

    /**
     * Copy final results to clipboard
     */
    const copyToClipboard = async (text) => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                // Fallback for non-secure contexts (e.g. HTTP)
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            alert('Report copied to clipboard!');
        } catch (error) {
            console.error('Copy failed:', error);
            alert('Failed to copy to clipboard');
        }
    };

    /**
     * Format file size for display
     */
    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    /**
     * Determine workflow step status for visual indicators
     */
    const getStepStatus = (stepName, completedSteps, currentStep) => {
        if (completedSteps.includes(stepName)) return 'completed';
        if (currentStep === stepName) return 'current';
        return 'pending';
    };

    // ===== RENDER COMPONENT =====

    return (
        <div className="container">
            {/* Connection Status Indicator */}
            <div className={`connection-status ${connectionStatus}`}>
                {connectionStatus === 'connected' ? '🟢 Connected' : '🔴 Connecting...'}
            </div>

            {/* Main Header */}
            <ZavaHeader />

            {/* Concept Upload Section */}
            <ConceptUploadSection
                uploadedFile={uploadedFile}
                isAnalyzing={isAnalyzing}
                onFileUpload={handleFileUpload}
                onStartAnalysis={startAnalysis}
                fileInputRef={fileInputRef}
            />

            {/* Analysis Progress Section */}
            {(isAnalyzing || analysisStatus.status !== 'ready') && (
                <AnalysisProgressSection analysisStatus={analysisStatus} />
            )}

            {/* Team Approval Section */}
            {analysisStatus.approval_request && (
                <TeamApprovalSection
                    approvalRequest={analysisStatus.approval_request}
                    approvalFeedback={approvalFeedback}
                    onFeedbackChange={setApprovalFeedback}
                    onSubmitApproval={submitApproval}
                />
            )}

            {/* Analysis Outputs Section */}
            {analysisStatus.outputs.length > 0 && (
                <AnalysisOutputsSection outputs={analysisStatus.outputs} />
            )}

            {/* Final Results Section */}
            {finalResults && (
                <FinalResultsSection
                    results={finalResults}
                    onCopyToClipboard={copyToClipboard}
                />
            )}

            {/* Error Display */}
            {analysisStatus.error && (
                <div className="section">
                    <div className="error-message">
                        <strong>Analysis Error:</strong> {analysisStatus.error}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Header component with Zava branding
 */
function ZavaHeader() {
    return (
        <header className="header">
            <h1>Zava Clothing Concept Analyzer</h1>
            <p>
                Intelligent fashion concept evaluation powered by AI agents.
                Upload your clothing concept pitch deck to receive comprehensive
                market analysis, design evaluation, and production feasibility assessment.
            </p>
        </header>
    );
}

/**
 * File upload and analysis start section
 */
function ConceptUploadSection({ uploadedFile, isAnalyzing, onFileUpload, onStartAnalysis, fileInputRef }) {
    return (
        <section className="section">
            <h2>📋 Upload Clothing Concept</h2>

            <div className="upload-area" onClick={() => fileInputRef.current?.click()}>
                <input
                    ref={fileInputRef}
                    type="file"
                    className="upload-input"
                    accept=".pptx"
                    onChange={onFileUpload}
                    disabled={isAnalyzing}
                />

                {uploadedFile ? (
                    <div>
                        <p><strong>Concept Uploaded:</strong> {uploadedFile.name}</p>
                        <p>Size: {formatFileSize(uploadedFile.size)}</p>
                    </div>
                ) : (
                    <div>
                        <p>📁 Click here to select your clothing concept pitch deck</p>
                        <p className="upload-hint">Supports PowerPoint (.pptx) files</p>
                    </div>
                )}

                <button className="upload-button" disabled={isAnalyzing}>
                    {uploadedFile ? 'Change File' : 'Choose File'}
                </button>
            </div>

            <button
                className="start-button"
                onClick={onStartAnalysis}
                disabled={!uploadedFile || isAnalyzing}
            >
                {isAnalyzing ? (
                    <>
                        <span className="spinner"></span>
                        Analyzing Concept...
                    </>
                ) : (
                    'Start Fashion Analysis'
                )}
            </button>
        </section>
    );
}

/**
 * Progress tracking section with workflow visualization
 */
function AnalysisProgressSection({ analysisStatus }) {
    const workflowSteps = [
        'Parse Clothing Concept',
        'Prepare Fashion Analysis',
        'Concurrent Fashion Analysis',
        'Generate Analysis Report',
        'Human Review'
    ];

    // Map technical step names to user-friendly display names
    const stepDisplayNames = {
        'Parse Clothing Concept': 'Parse Clothing Concept',
        'Prepare Fashion Analysis': 'Prepare Fashion Analysis',
        'Concurrent Fashion Analysis': 'Agent Analysis',
        'Generate Analysis Report': 'Generate Analysis Report',
        'Human Review': 'Human Review'
    };

    // Determine completed steps from the latest progress update
    const latestStep = analysisStatus.steps[analysisStatus.steps.length - 1];
    const completedSteps = latestStep?.completed_steps || [];

    return (
        <section className="section">
            <h2>📊 Analysis Progress</h2>

            <div className="progress-container">
                <div className="progress-bar">
                    <div
                        className="progress-fill"
                        style={{ width: `${analysisStatus.progress}%` }}
                    ></div>
                </div>

                <div className="status-text">
                    {analysisStatus.status === 'waiting_approval' ? 'Waiting for Team Approval' : analysisStatus.current_step}
                </div>

                <div className="current-step">
                    Progress: {analysisStatus.progress}% Complete
                </div>
            </div>

            <div className="workflow-steps">
                {workflowSteps.map((stepName) => {
                    const stepStatus = getStepStatus(stepName, completedSteps, analysisStatus.current_step);
                    const displayName = stepDisplayNames[stepName] || stepName;
                    return (
                        <div key={stepName} className={`step ${stepStatus}`}>
                            <div className="step-name">{displayName}</div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

/**
 * Team approval section for human decision-making
 */
function TeamApprovalSection({ approvalRequest, approvalFeedback, onFeedbackChange, onSubmitApproval }) {
    return (
        <section className="approval-section">
            <h2>🤔 Zava Team Approval Required</h2>

            <div className="approval-question">
                {approvalRequest.question}
            </div>

            <div className="approval-context">
                {approvalRequest.context}
            </div>

            <div className="feedback-section">
                <label htmlFor="approval-feedback">
                    Additional Feedback (Optional):
                </label>
                <textarea
                    id="approval-feedback"
                    className="feedback-textarea"
                    value={approvalFeedback}
                    onChange={(e) => onFeedbackChange(e.target.value)}
                    placeholder="Provide additional context for your decision..."
                />
            </div>

            <div className="approval-buttons">
                <button
                    className="approval-button yes"
                    onClick={() => onSubmitApproval('yes')}
                >
                    Approve for Development
                </button>
                <button
                    className="approval-button no"
                    onClick={() => onSubmitApproval('no')}
                >
                    Reject Concept
                </button>
            </div>
        </section>
    );
}

/**
 * Real-time analysis outputs section
 */
function AnalysisOutputsSection({ outputs }) {
    return (
        <section className="section">
            <h2>📝 Analysis Outputs</h2>

            <div className="outputs-container">
                {outputs.map((output, index) => (
                    <div key={index} className={`output-item ${output.type}`}>
                        <div className="output-header">
                            <span className="output-source">{output.source}</span>
                            <span className="output-timestamp">
                                {new Date(output.timestamp).toLocaleTimeString()}
                            </span>
                        </div>
                        <div className="output-content">{output.content}</div>
                    </div>
                ))}
            </div>
        </section>
    );
}

/**
 * Final results display section
 */
function FinalResultsSection({ results, onCopyToClipboard }) {
    const isApproved = results.result === 'APPROVED';

    return (
        <section className={`final-results ${isApproved ? '' : 'rejected'}`}>
            <h2>
                {isApproved ? 'Concept Approved for Development!' : 'Concept Not Selected'}
            </h2>

            <div className="results-container">
                <div className="result-preview">
                    <h3>Analysis Summary</h3>
                    <p>
                        <strong>Decision:</strong> {results.result}
                        {results.filename && (
                            <><br /><strong>Report:</strong> {results.filename}</>
                        )}
                    </p>

                    {results.document && (
                        <div>
                            <button
                                className="copy-button"
                                onClick={() => onCopyToClipboard(results.document)}
                            >
                                📋 Copy Full Report
                            </button>
                        </div>
                    )}
                </div>

                {results.document && (
                    <div className="result-preview">
                        <h3>Generated Report</h3>
                        <div className="result-content">
                            {results.document}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

// ===== UTILITY FUNCTIONS =====

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getStepStatus(stepName, completedSteps, currentStep) {
    if (completedSteps.includes(stepName)) return 'completed';
    if (currentStep === stepName) return 'current';
    return 'pending';
}

// ===== RENDER APPLICATION =====

ReactDOM.render(<ZavaConceptAnalyzer />, document.getElementById('root'));