"""
FastAPI backend server for Zava Clothing Concept Analysis System.

This server provides REST API endpoints and WebSocket connections for the
Zava clothing company's concept evaluation workflow, enabling real-time
interaction with the fashion analysis process.
"""

import asyncio
import json
import os
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
import traceback

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

# Import our modular workflow components
from core.workflow_manager import ZavaConceptWorkflowManager


class ConceptAnalysisStatus(BaseModel):
    """
    Data model representing the current status of a clothing concept analysis.

    This model tracks the progress, current step, and results of the
    fashion analysis workflow for real-time UI updates.
    """

    status: str  # ready, running, waiting_approval, completed, error
    progress: int  # 0-100 percentage of completion
    current_step: str  # Current workflow step description
    steps: List[Dict[str, Any]]  # History of completed steps
    outputs: List[Dict[str, Any]]  # Analysis outputs and logs
    approval_request: Optional[Dict[str, Any]] = None  # Pending approval request
    error: Optional[str] = None  # Error message if status is 'error'


class ConceptApprovalDecision(BaseModel):
    """
    Data model for human approval decisions on clothing concepts.

    Captures the decision (approve/reject) and any additional feedback
    from Zava's design team.
    """

    decision: str  # "yes" to approve, "no" to reject
    feedback: Optional[str] = ""  # Optional feedback or comments


class ZavaWebSocketManager:
    """
    Manages WebSocket connections for real-time updates during concept analysis.

    This class handles broadcasting progress updates, analysis outputs, and
    approval requests to all connected UI clients.
    """

    def __init__(self):
        """Initialize the WebSocket connection manager."""
        self.active_connections: List[WebSocket] = []
        self.connection_count = 0

    async def connect(self, websocket: WebSocket) -> None:
        """
        Accept and register a new WebSocket connection.

        Args:
            websocket: The WebSocket connection to register
        """
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_count += 1
        print(f"WebSocket connected (Total: {self.connection_count})")

    def disconnect(self, websocket: WebSocket) -> None:
        """
        Remove a WebSocket connection from the active list.

        Args:
            websocket: The WebSocket connection to remove
        """
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"WebSocket disconnected (Remaining: {len(self.active_connections)})")

    async def broadcast_message(self, message: dict) -> None:
        """
        Send a message to all connected WebSocket clients.

        This method handles connection errors gracefully by removing
        disconnected clients from the active list.

        Args:
            message: Dictionary to send as JSON to all clients
        """
        disconnected = []

        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except Exception as e:
                print(f"WARNING: WebSocket send error: {e}")
                disconnected.append(connection)

        # Clean up disconnected clients
        for conn in disconnected:
            self.disconnect(conn)


# Initialize FastAPI application
app = FastAPI(
    title="Zava Clothing Concept Analyzer",
    description="Fashion concept evaluation system for Zava clothing company",
    version="1.0.0"
)

# Global application state
websocket_manager = ZavaWebSocketManager()
workflow_manager: Optional[ZavaConceptWorkflowManager] = None
current_analysis_status = ConceptAnalysisStatus(
    status="ready",
    progress=0,
    current_step="Ready to analyze clothing concepts",
    steps=[],
    outputs=[],
    approval_request=None
)
# Track original filenames for temp files
original_filenames: Dict[str, str] = {}

# Mount static files for the UI
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_main_ui():
    """
    Serve the main Zava concept analysis UI.

    Returns:
        HTMLResponse: The main application interface
    """
    try:
        with open("static/index.html", "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(
            content="<h1>Zava UI Not Found</h1><p>Please ensure static/index.html exists.</p>",
            status_code=404
        )


@app.post("/upload-concept")
async def upload_clothing_concept(file: UploadFile = File(...)):
    """
    Upload a clothing concept pitch deck for analysis.

    This endpoint accepts PowerPoint files containing new clothing concept
    proposals and prepares them for the fashion analysis workflow.

    Args:
        file: Uploaded .pptx file containing the clothing concept pitch

    Returns:
        Dict containing upload confirmation and file details

    Raises:
        HTTPException: If file format is invalid or upload fails
    """
    global current_analysis_status

    try:
        # Validate file format
        if not file.filename or not file.filename.endswith('.pptx'):
            raise HTTPException(
                status_code=400,
                detail="Only .pptx PowerPoint files are supported for concept submissions"
            )

        # Save uploaded file to temporary location
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pptx") as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            temp_file_path = tmp_file.name

        # Store the original filename for later use
        original_filenames[temp_file_path] = file.filename

        # Update analysis status
        current_analysis_status.status = "concept_uploaded"
        current_analysis_status.current_step = f"Clothing concept uploaded: {file.filename}"

        # Log the upload
        await add_analysis_output(
            source="Upload",
            content=f"Concept file '{file.filename}' uploaded successfully",
            output_type="info"
        )

        # Broadcast update to connected clients
        await websocket_manager.broadcast_message({
            "type": "status_update",
            "status": current_analysis_status.model_dump()
        })

        return {
            "message": "Clothing concept uploaded successfully",
            "filename": file.filename,
            "temp_path": temp_file_path,
            "file_size": len(content)
        }

    except Exception as e:
        # Handle upload errors
        error_msg = f"Failed to upload clothing concept: {str(e)}"
        current_analysis_status.status = "error"
        current_analysis_status.error = error_msg

        await websocket_manager.broadcast_message({
            "type": "error",
            "error": error_msg
        })

        raise HTTPException(status_code=500, detail=error_msg)


@app.post("/start-analysis/{temp_path:path}")
async def start_concept_analysis(temp_path: str):
    """
    Start the comprehensive fashion analysis workflow for an uploaded concept.

    This endpoint initiates the multi-stage analysis process including
    market research, design evaluation, and production assessment.

    Args:
        temp_path: Path to the temporarily stored concept file

    Returns:
        Dict confirming analysis startup

    Raises:
        HTTPException: If workflow is already running or startup fails
    """
    global workflow_manager, current_analysis_status

    try:
        if current_analysis_status.status == "running":
            raise HTTPException(
                status_code=400,
                detail="Fashion analysis already in progress"
            )

        # Initialize the workflow manager with callback functions
        workflow_manager = ZavaConceptWorkflowManager(
            progress_callback=update_analysis_progress,
            output_callback=add_analysis_output,
            approval_callback=request_team_approval,
            error_callback=handle_workflow_error
        )

        # Reset analysis state
        current_analysis_status.status = "running"
        current_analysis_status.progress = 0
        current_analysis_status.current_step = "Initializing fashion analysis workflow..."
        current_analysis_status.steps = []
        current_analysis_status.outputs = []
        current_analysis_status.error = None
        current_analysis_status.approval_request = None

        # Broadcast status update
        await websocket_manager.broadcast_message({
            "type": "status_update",
            "status": current_analysis_status.model_dump()
        })

        # Start the analysis workflow in the background
        asyncio.create_task(execute_concept_analysis_async(temp_path))

        return {"message": "Zava fashion analysis workflow started successfully"}

    except Exception as e:
        error_msg = f"Failed to start concept analysis: {str(e)}"
        current_analysis_status.status = "error"
        current_analysis_status.error = error_msg

        await websocket_manager.broadcast_message({
            "type": "error",
            "error": error_msg
        })

        raise HTTPException(status_code=500, detail=error_msg)


@app.post("/submit-approval")
async def submit_team_approval(approval: ConceptApprovalDecision):
    """
    Submit Zava team's approval decision for a clothing concept.

    This endpoint processes human approval decisions and continues
    the workflow based on the team's evaluation.

    Args:
        approval: The team's decision (approve/reject) with optional feedback

    Returns:
        Dict confirming approval submission

    Raises:
        HTTPException: If no active workflow or not waiting for approval
    """
    global workflow_manager, current_analysis_status

    try:
        if not workflow_manager:
            raise HTTPException(
                status_code=400,
                detail="No active concept analysis workflow"
            )

        if current_analysis_status.status != "waiting_approval":
            raise HTTPException(
                status_code=400,
                detail="Workflow not waiting for team approval"
            )

        # Send the approval decision to the workflow
        await workflow_manager.send_approval_decision(approval.decision, approval.feedback)

        # Update status to reflect decision processing
        current_analysis_status.status = "running"
        current_analysis_status.approval_request = None
        current_analysis_status.current_step = f"Processing team decision: {approval.decision.upper()}"

        # Log the decision
        decision_text = "APPROVED" if approval.decision.lower() in ['yes', 'approve'] else "REJECTED"
        await add_analysis_output(
            source="Zava Team",
            content=f"Concept {decision_text}" + (f" - {approval.feedback}" if approval.feedback else ""),
            output_type="decision"
        )

        # Broadcast status update
        await websocket_manager.broadcast_message({
            "type": "status_update",
            "status": current_analysis_status.model_dump()
        })

        return {"message": f"Team approval submitted: {decision_text}"}

    except Exception as e:
        error_msg = f"Failed to process approval: {str(e)}"
        await websocket_manager.broadcast_message({
            "type": "error",
            "error": error_msg
        })
        raise HTTPException(status_code=500, detail=error_msg)


@app.get("/analysis-status")
async def get_analysis_status():
    """
    Get the current status of the clothing concept analysis workflow.

    Returns:
        Dict: Current analysis status including progress and outputs
    """
    return current_analysis_status.model_dump()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time concept analysis updates.

    This endpoint maintains persistent connections with UI clients
    to provide real-time updates on analysis progress, outputs,
    and approval requests.

    Args:
        websocket: WebSocket connection from the client
    """
    await websocket_manager.connect(websocket)

    try:
        # Send current status immediately upon connection
        await websocket.send_text(json.dumps({
            "type": "status_update",
            "status": current_analysis_status.model_dump()
        }))

        # Keep connection alive and handle any incoming messages
        while True:
            try:
                # Listen for client messages (though we don't expect many)
                await websocket.receive_text()
            except WebSocketDisconnect:
                break

    except WebSocketDisconnect:
        pass
    finally:
        websocket_manager.disconnect(websocket)


# Workflow callback functions for UI integration

async def update_analysis_progress(step: str, progress: int, step_data: Dict[str, Any] = None):
    """
    Update the analysis progress and notify connected clients.

    Args:
        step: Current step name/description
        progress: Progress percentage (0-100)
        step_data: Additional step information and metadata
    """
    global current_analysis_status

    current_analysis_status.current_step = step
    current_analysis_status.progress = progress

    # Add step information to history
    completed_steps = []
    if step_data and "completed_steps" in step_data:
        completed_steps = step_data["completed_steps"]

    step_info = {
        "name": step,
        "progress": progress,
        "timestamp": datetime.now().isoformat(),
        "completed_steps": completed_steps
    }

    # Add any additional step data
    if step_data:
        step_info.update({k: v for k, v in step_data.items() if k != "completed_steps"})

    current_analysis_status.steps.append(step_info)

    # Broadcast progress update
    await websocket_manager.broadcast_message({
        "type": "progress_update",
        "step": step,
        "progress": progress,
        "completed_steps": completed_steps,
        "status": current_analysis_status.model_dump()
    })


async def add_analysis_output(source: str, content: str, output_type: str = "text"):
    """
    Add analysis output/result and notify connected clients.

    Args:
        source: Source of the output (e.g., "Market Agent", "Design Agent")
        content: Output content/message
        output_type: Type of output (text, info, warning, error, success, decision)
    """
    global current_analysis_status

    output = {
        "source": source,
        "content": content,
        "type": output_type,
        "timestamp": datetime.now().isoformat()
    }

    current_analysis_status.outputs.append(output)

    # Broadcast new output
    await websocket_manager.broadcast_message({
        "type": "output_added",
        "output": output,
        "status": current_analysis_status.model_dump()
    })


async def request_team_approval(question: str, context: str):
    """
    Request human approval from Zava team and update UI.

    Args:
        question: The approval question to present
        context: Additional context for the decision
    """
    global current_analysis_status

    current_analysis_status.status = "waiting_approval"
    current_analysis_status.approval_request = {
        "question": question,
        "context": context,
        "timestamp": datetime.now().isoformat()
    }

    # Broadcast approval request
    await websocket_manager.broadcast_message({
        "type": "approval_request",
        "question": question,
        "context": context,
        "status": current_analysis_status.model_dump()
    })


async def handle_workflow_error(error: str):
    """
    Handle workflow errors and update UI status.

    Args:
        error: Error message to display
    """
    global current_analysis_status

    current_analysis_status.status = "error"
    current_analysis_status.error = error

    await websocket_manager.broadcast_message({
        "type": "error",
        "error": error,
        "status": current_analysis_status.model_dump()
    })


async def execute_concept_analysis_async(concept_file_path: str):
    """
    Execute the complete concept analysis workflow asynchronously.

    This function runs the full fashion analysis pipeline and handles
    the final results, including generating reports and updating UI.

    Args:
        concept_file_path: Path to the concept file to analyze
    """
    global current_analysis_status, workflow_manager, original_filenames

    try:
        # Get the original filename for this temp file
        original_filename = original_filenames.get(concept_file_path, "Unknown_Concept.pptx")

        # Run the complete concept analysis workflow
        result = await workflow_manager.analyze_clothing_concept(concept_file_path, original_filename)

        # Update final status
        current_analysis_status.status = "completed"
        current_analysis_status.progress = 100
        current_analysis_status.current_step = f"Analysis completed: {result}"

        # Try to read generated report files for display
        final_document = None
        filename = None

        try:
            import glob

            # Look for generated reports based on result
            if result == "APPROVED":
                # Look for approved concept reports
                approved_files = glob.glob("zava_approved_concept_*.md")
                if approved_files:
                    latest_file = max(approved_files, key=os.path.getctime)
                    with open(latest_file, 'r', encoding='utf-8') as f:
                        final_document = f.read()
                    filename = latest_file
            else:  # REJECTED
                # Look for rejection notification files
                rejection_files = glob.glob("zava_concept_rejection_*.md")
                if rejection_files:
                    latest_file = max(rejection_files, key=os.path.getctime)
                    with open(latest_file, 'r', encoding='utf-8') as f:
                        final_document = f.read()
                    filename = latest_file

        except Exception as e:
            print(f"Could not read generated report file: {e}")

        # Broadcast completion with results
        await websocket_manager.broadcast_message({
            "type": "workflow_completed",
            "result": result,
            "finalDocument": final_document,
            "filename": filename,
            "status": current_analysis_status.model_dump()
        })

    except Exception as e:
        error_msg = f"Concept analysis failed: {str(e)}"
        print(f"Workflow execution error: {error_msg}")
        print(traceback.format_exc())

        current_analysis_status.status = "error"
        current_analysis_status.error = error_msg

        await websocket_manager.broadcast_message({
            "type": "error",
            "error": error_msg,
            "status": current_analysis_status.model_dump()
        })


# Application startup and configuration
if __name__ == "__main__":
    import uvicorn

    print("Starting Zava Clothing Concept Analysis Server...")
    print("Navigate to http://localhost:8000 to access the Zava concept analyzer")
    print("WebSocket endpoint available at ws://localhost:8000/ws")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        reload=False  # Set to True for development
    )