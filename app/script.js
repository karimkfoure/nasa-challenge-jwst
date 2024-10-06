import { GestureRecognizer, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
let gestureRecognizer;
let runningMode = "IMAGE";
let webcamRunning = false;

// Add these variables at the top of your script, after the existing declarations
let zoomLevel = 1;
let panX = 0;
let panY = 0;
let lastDistance = null;
let lastPanX = null;
let lastPanY = null;

// Add these new variables
const STAR_THRESHOLD = 210; // Adjust this value to fine-tune star detection
let starMatrix = [];
const STAR_PROXIMITY_THRESHOLD = 10; // Distance to trigger sound

// Add these lines at the beginning of the file, after the import statements
const imageCanvas = document.getElementById("imageCanvas");
const imageCtx = imageCanvas.getContext("2d");


// Before we can use HandLandmarker class we must wait for it to finish
// loading. Machine Learning models can be large and take a moment to
// get everything needed to run.
const createGestureRecognizer = async () => {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
    gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task",
            delegate: "GPU"
        },
        runningMode: runningMode,
        numHands: 2
    });
    // demosSection.classList.remove("invisible");
};
createGestureRecognizer();

// Add this function to detect stars and create the star matrix
function detectStars(img) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, 0, 0, img.width, img.height);
    const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
    const data = imageData.data;

    starMatrix = [];
    for (let y = 0; y < img.height; y++) {
        starMatrix[y] = [];
        for (let x = 0; x < img.width; x++) {
            const i = (y * img.width + x) * 4;
            const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (brightness > STAR_THRESHOLD) {
                starMatrix[y][x] = {isStar: true, size: 1};
            } else {
                starMatrix[y][x] = {isStar: false, size: 0};
            }
        }
    }

    // Merge adjacent star pixels and calculate sizes
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            if (starMatrix[y][x].isStar) {
                let size = calculateStarSize(x, y);
                starMatrix[y][x].size = size;
            }
        }
    }
}

function calculateStarSize(startX, startY) {
    let size = 0;
    let stack = [[startX, startY]];
    starMatrix[startY][startX].checked = true;

    while (stack.length > 0) {
        let [x, y] = stack.pop();
        size++;

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let newX = x + dx;
                let newY = y + dy;
                if (newX >= 0 && newX < starMatrix[0].length &&
                    newY >= 0 && newY < starMatrix.length &&
                    starMatrix[newY][newX].isStar &&
                    !starMatrix[newY][newX].checked) {
                    stack.push([newX, newY]);
                    starMatrix[newY][newX].checked = true;
                }
            }
        }
    }

    return size;
}

// Add this function to load and draw the image
function loadAndDrawImage() {
    const img = new Image();
    img.onload = function() {
        // Set canvas size to match its container
        imageCanvas.width = window.innerWidth;
        imageCanvas.height = window.innerHeight;

        // Function to update image based on hand positions
        function updateImage(processedHands) {
            imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
            
            let hueRotation = 0;
            let brightness = 100;
            let leftHand = processedHands["Right"];
            let rightHand = processedHands["Left"];

            // Handle zooming with both fists closed
            if (leftHand && rightHand && leftHand.gesture === "Closed_Fist" && rightHand.gesture === "Closed_Fist") {
                let currentDistance = getDistanceBetweenHands(processedHands);
                if (lastDistance !== null) {
                    let distanceChange = currentDistance - lastDistance;
                    zoomLevel += distanceChange * 3;
                    zoomLevel = Math.max(1, Math.min(zoomLevel, 10));
                }
                lastDistance = currentDistance;

                // Update pan based on the midpoint between hands
                let midX = (leftHand.center.x + rightHand.center.x) / 2;
                let midY = (leftHand.center.y + rightHand.center.y) / 2;
                panX = (0.5 - midX) * imageCanvas.width * (zoomLevel - 1);
                panY = (0.5 - midY) * imageCanvas.height * (zoomLevel - 1);
                
                lastPanX = null;
                lastPanY = null;
            } 
            // Handle panning with one fist closed
            else if ((leftHand && leftHand.gesture === "Closed_Fist") || (rightHand && rightHand.gesture === "Closed_Fist")) {
                let activeHand = leftHand && leftHand.gesture === "Closed_Fist" ? leftHand : rightHand;
                
                if (lastPanX !== null && lastPanY !== null) {
                    let deltaX = activeHand.center.x - lastPanX;
                    let deltaY = activeHand.center.y - lastPanY;
                    
                    panX -= deltaX * imageCanvas.width * (zoomLevel - 1) * 2;
                    panY -= deltaY * imageCanvas.height * (zoomLevel - 1) * 2;
                    
                    // Limit pan to keep image on screen
                    let maxPanX = (zoomLevel - 1) * imageCanvas.width / 2;
                    let maxPanY = (zoomLevel - 1) * imageCanvas.height / 2;
                    panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
                    panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
                }
                
                lastPanX = activeHand.center.x;
                lastPanY = activeHand.center.y;
                lastDistance = null;
            } 
            else {
                lastDistance = null;
                lastPanX = null;
                lastPanY = null;
            }

            // Handle hue and brightness with open palm (right hand)
            if (rightHand && rightHand.gesture === "Open_Palm") {
                hueRotation = rightHand.center.x * 360;
                brightness = 50 + (1 - rightHand.center.y) * 100;
            }

            // Handle saturation with open palm (left hand)
            if (leftHand && leftHand.gesture === "Open_Palm") {
                let saturation = leftHand.center.x * 200; // 0-200% range for saturation
                imageCtx.filter += ` saturate(${saturation}%)`;
            }
            
            // Apply glow effects before drawing the main image
            if (leftHand) {
                drawHandCircle(leftHand.center);
            }
            if (rightHand) {
                drawHandCircle(rightHand.center);
            }

            // Apply filters
            imageCtx.filter = `hue-rotate(${hueRotation}deg) brightness(${brightness}%)`;
            
            // Calculate drawing dimensions
            const imgRatio = img.width / img.height;
            const canvasRatio = imageCanvas.width / imageCanvas.height;
            let drawWidth, drawHeight, startX, startY;

            if (canvasRatio > imgRatio) {
                drawWidth = imageCanvas.width * zoomLevel;
                drawHeight = drawWidth / imgRatio;
                startX = panX - (drawWidth - imageCanvas.width) / 2;
                startY = panY - (drawHeight - imageCanvas.height) / 2;
            } else {
                drawHeight = imageCanvas.height * zoomLevel;
                drawWidth = drawHeight * imgRatio;
                startX = panX - (drawWidth - imageCanvas.width) / 2;
                startY = panY - (drawHeight - imageCanvas.height) / 2;
            }

            // Draw the image with applied filters and zoom
            imageCtx.drawImage(img, startX, startY, drawWidth, drawHeight);
        }

        // Initial draw
        updateImage({});

        // Expose the updateImage function
        window.updateImageEffects = updateImage;

        // Detect stars after the image is loaded
        detectStars(img);


        // // Initialize the oscillator
        // osc = new Tone.Oscillator().toDestination();
        // osc.volume.value = -Infinity; // Start silent
        // osc.start();
    };
    const randomNumber = Math.floor(Math.random() * 8) + 1;
    img.src = `photos/${randomNumber}.jpeg`;
}

loadAndDrawImage();

// Add a window resize event listener to redraw the image when the window is resized
window.addEventListener('resize', loadAndDrawImage);

/********************************************************************
// Demo 2: Continuously grab image from webcam stream and detect it.
********************************************************************/
const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const gestureOutput = document.getElementById("gesture_output");

// Check if webcam access is supported.
function hasGetUserMedia() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

if (!hasGetUserMedia()) {
    console.warn("getUserMedia() is not supported by your browser");
}

// Enable the live webcam view and start detection.
const waitForGestureRecognizer = async () => {
    while (!gestureRecognizer) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for 100ms
    }
    webcamRunning = true;
    // getUsermedia parameters.
    const constraints = {
        video: true
    };
    // Activate the webcam stream.
    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
    });
};
waitForGestureRecognizer();

let lastVideoTime = -1;
let results = undefined;

canvasElement.style.width = '100%';
canvasElement.style.height = '100%';
// webcamElement.style.width = '100%';
// webcamElement.style.height = '100%';

function processHandResults(results) {
    const processedHands = {};

    if (results.landmarks && results.handednesses) {
        for (let i = 0; i < results.landmarks.length; i++) {
            const landmarks = results.landmarks[i];
            const handedness = results.handednesses[i][0];
            const gesture = results.gestures[i][0];
            const center = {
                x: (landmarks[5].x + landmarks[17].x) / 2,
                y: (landmarks[0].y + landmarks[9].y) / 2
            }

            const handInfo = {
                landmarks: landmarks,
                center: center,
                handedness: handedness.categoryName,
                gesture: gesture ? gesture.categoryName : 'None',
                confidence: handedness.score,
                position: {
                    x: (landmarks[5].x + landmarks[17].x) / 2,
                    y: (landmarks[0].y + landmarks[9].y) / 2
                }
            };

            processedHands[handedness.categoryName] = handInfo;
        }
    }

    return processedHands;
}

function getDistanceBetweenHands(processedHands) {
    let leftHand = processedHands["Left"];
    let rightHand = processedHands["Right"];
    return Math.sqrt(Math.pow(leftHand.center.x - rightHand.center.x, 2) + Math.pow(leftHand.center.y - rightHand.center.y, 2));
}

async function predictWebcam() {
    // const webcamElement = document.getElementById("webcam");
    // Now let's start detecting the stream.
    if (runningMode === "IMAGE") {
        runningMode = "VIDEO";
        await gestureRecognizer.setOptions({ runningMode: "VIDEO", numHands: 2 });
    }

    let nowInMs = Date.now();
    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        results = gestureRecognizer.recognizeForVideo(video, nowInMs);
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);   

    const drawingUtils = new DrawingUtils(canvasCtx);

    if (results.landmarks) {
        const processedHands = processHandResults(results);

        // Update image effects based on hand positions and gestures
        window.updateImageEffects(processedHands);

        let leftHand = processedHands["Right"];
        let rightHand = processedHands["Left"];
        // console.log('left', leftHand?.gesture);
        // console.log('right', rightHand?.gesture);

        if (leftHand) {
            // drawWebcamPreviewLandmarks(leftHand.landmarks, drawingUtils);
            drawHandCircle(leftHand.center);
        }

        if (rightHand) {    
            // drawWebcamPreviewLandmarks(rightHand.landmarks, drawingUtils);
            drawHandCircle(rightHand.center);
        }
    }
    canvasCtx.restore();

    // Call this function again to keep predicting when the browser is ready.
    if (webcamRunning === true) {
        window.requestAnimationFrame(predictWebcam);
    }
}

function drawWebcamPreviewLandmarks(landmarks, drawingUtils) {
    drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, {
        color: "#00FF00",
        lineWidth: 5
    });
    drawingUtils.drawLandmarks(landmarks, {
        color: "#FF0000",
        lineWidth: 2
    });
}

function drawHandCircle(center) {
    if (center != null) {
        let x = remap(center.x, 1, 0, 0, imageCanvas.width);
        let y = remap(center.y, 0, 1, 0, imageCanvas.height);
        
        // Save the current context state
        imageCtx.save();
        
        // Create multiple layers of glow
        for (let i = 0; i < 3; i++) {
            let radius = 100 + i * 50;
            let gradient = imageCtx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, `rgba(255, 255, 255, ${0.2 - i * 0.05})`);
            gradient.addColorStop(0.7, `rgba(255, 255, 255, ${0.1 - i * 0.03})`);
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

            imageCtx.globalCompositeOperation = 'screen';
            imageCtx.fillStyle = gradient;
            imageCtx.beginPath();
            imageCtx.arc(x, y, radius, 0, 2 * Math.PI);
            imageCtx.fill();
        }

        // Add a subtle color tint
        let colorGradient = imageCtx.createRadialGradient(x, y, 0, x, y, 150);
        colorGradient.addColorStop(0, `rgba(100, 200, 255, 0.2)`);
        colorGradient.addColorStop(1, 'rgba(100, 200, 255, 0)');

        imageCtx.globalCompositeOperation = 'overlay';
        imageCtx.fillStyle = colorGradient;
        imageCtx.beginPath();
        imageCtx.arc(x, y, 150, 0, 2 * Math.PI);
        imageCtx.fill();

        // Enhance bright spots
        let enhanceGradient = imageCtx.createRadialGradient(x, y, 0, x, y, 200);
        enhanceGradient.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
        enhanceGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
        enhanceGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        imageCtx.globalCompositeOperation = 'lighten';
        imageCtx.fillStyle = enhanceGradient;
        imageCtx.beginPath();
        imageCtx.arc(x, y, 200, 0, 2 * Math.PI);
        imageCtx.fill();

        // Restore the context state
        imageCtx.restore();

        // Check for nearby stars
        checkNearbyStars(x, y);
    }
}

// Add this new function to check for nearby stars and play sounds
function checkNearbyStars(x, y) {
}

function remap(value, istart, istop, ostart, ostop) {
  // Ensure values are numerical to avoid potential errors
  value = Number(value);
  istart = Number(istart);
  istop = Number(istop);
  ostart = Number(ostart);
  ostop = Number(ostop);

  // Perform the mapping calculation
  return ostart + (ostop - ostart) * ((value - istart) / (istop - istart));
}