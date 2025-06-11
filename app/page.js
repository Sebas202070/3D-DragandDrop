
'use client'; // ¡IMPORTANTE! Esto le dice a Next.js que este es un Client Component

import React, { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam'; // Para acceder a la cámara de manera sencilla
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'; // Las librerías de MediaPipe

// --- Constantes para la detección de gestos ---
// Ajusta este valor: es la distancia (normalizada 0-1) entre el pulgar y el índice para detectar la pinza.
// Podrías necesitar un valor más alto o más bajo según tu cámara y la iluminación.
const PINCH_THRESHOLD = 0.08;

export default function Home() {
  const webcamRef = useRef(null); // Referencia al componente Webcam
  const canvasRef = useRef(null); // Referencia al canvas para dibujar los landmarks
  const handLandmarkerRef = useRef(null); // Referencia al modelo de MediaPipe HandLandmarker
  const animationFrameId = useRef(null); // Para controlar el bucle de requestAnimationFrame

  const [handLandmarkerLoaded, setHandLandmarkerLoaded] = useState(false); // Estado para saber si el modelo está cargado
  const [images, setImages] = useState([ // Array de imágenes con sus posiciones y estado de 'grabbed'
    { id: 'img1', src: '/Banana.png', x: 100, y: 100, grabbed: false },
    { id: 'img2', src: '/Frutilla.png', x: 300, y: 150, grabbed: false },
    { id: 'img3', src: '/Sandia.png', x: 200, y: 300, grabbed: false },
  ]);
  const imagesRef = useRef(images);

useEffect(() => {
  imagesRef.current = images;
}, [images]);
  const [grabbingHandIndex, setGrabbingHandIndex] = useState(null); // Guarda el índice de la mano que está agarrando (0 o 1)
  const [initialGrabOffset, setInitialGrabOffset] = useState({ x: 0, y: 0 }); // Offset entre la pinza y la imagen al agarrar

  // --- 1. Inicializar el modelo de MediaPipe HandLandmarker ---
  const createHandLandmarker = useCallback(async () => {
    // Necesitamos el FilesetResolver para cargar los archivos WASM del modelo
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    // Crear el HandLandmarker desde las opciones
    handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {

     baseOptions: {
  modelAssetPath: 'https://storage.googleapis.com/mediapipe-assets/hand_landmarker.task',
  delegate: 'GPU'
},

      runningMode: "VIDEO", // Modo de operación para procesar frames de video
      numHands: 2 // Detectar hasta 2 manos
    });
    setHandLandmarkerLoaded(true);
    console.log("HandLandmarker cargado y listo.");
  }, []);

  // Cargar el modelo cuando el componente se monta
  useEffect(() => {
    createHandLandmarker();
  }, [createHandLandmarker]);

  // --- 2. Función para dibujar los landmarks en el canvas (útil para depuración) ---
  const drawLandmarks = useCallback((landmarks, canvas, video) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Asegurarse de que el tamaño del canvas coincida con el video para un dibujo preciso
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Limpiar el canvas en cada frame

    // Dibujar cada punto clave de cada mano detectada
    for (const hand of landmarks) {
      for (const landmark of hand) {
        const x = landmark.x * canvas.width;
        const y = landmark.y * canvas.height;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI); // Dibuja un círculo
        ctx.fillStyle = 'red';
        ctx.fill();
      }
      // Opcional: Puedes dibujar líneas para conectar los puntos y formar un "esqueleto" de la mano
      // Esto requeriría importar y usar las DrawingUtils de MediaPipe o implementar tu propia lógica.
    }
  }, []);

  // --- 3. Lógica principal: Detección de Pinza y Arrastre de Imágenes ---
 const detectPinchAndDrag = useCallback((results) => {
  const video = webcamRef.current.video;
  if (!video || !results?.landmarks?.length) {
    imagesRef.current.forEach(img => (img.grabbed = false));
    setGrabbingHandIndex(null);
    return;
  }

  const currentGrabbingHand = grabbingHandIndex;
  let newGrabbingHandIndex = null;
  let newHandPosition = null;

  results.landmarks.forEach((handLandmarks, handIndex) => {
    const thumbTip = handLandmarks[4];
    const indexTip = handLandmarks[8];
    const distance = Math.sqrt(
      (thumbTip.x - indexTip.x) ** 2 +
      (thumbTip.y - indexTip.y) ** 2 +
      (thumbTip.z - indexTip.z) ** 2
    );

    const handX = (1 - indexTip.x) * video.videoWidth;
    const handY = indexTip.y * video.videoHeight;

    if (distance < PINCH_THRESHOLD) {
      newGrabbingHandIndex = handIndex;
      newHandPosition = { x: handX, y: handY };
    }
  });

  const updatedImages = [...imagesRef.current];

  if (newGrabbingHandIndex !== null && currentGrabbingHand === null) {
    const grabbedIndex = updatedImages.findIndex(img =>
      newHandPosition.x > img.x &&
      newHandPosition.x < img.x + 80 &&
      newHandPosition.y > img.y &&
      newHandPosition.y < img.y + 80
    );

    if (grabbedIndex !== -1) {
      updatedImages[grabbedIndex].grabbed = true;
      setGrabbingHandIndex(newGrabbingHandIndex);
      setInitialGrabOffset({
        x: newHandPosition.x - updatedImages[grabbedIndex].x,
        y: newHandPosition.y - updatedImages[grabbedIndex].y,
      });
    }
  } else if (newGrabbingHandIndex !== null && currentGrabbingHand === newGrabbingHandIndex) {
    const grabbedIndex = updatedImages.findIndex(img => img.grabbed);
    if (grabbedIndex !== -1) {
      updatedImages[grabbedIndex].x = newHandPosition.x - initialGrabOffset.x;
      updatedImages[grabbedIndex].y = newHandPosition.y - initialGrabOffset.y;
    }
  } else if (newGrabbingHandIndex === null && currentGrabbingHand !== null) {
    const grabbedIndex = updatedImages.findIndex(img => img.grabbed);
    if (grabbedIndex !== -1) {
      updatedImages[grabbedIndex].grabbed = false;
    }
    setGrabbingHandIndex(null);
    setInitialGrabOffset({ x: 0, y: 0 });
  }

  // Actualizar solo una vez (opcional: puedes hacerlo con debounce si aún hay lag)
  imagesRef.current = updatedImages;
  setImages(updatedImages); // Solo 1 render por frame (en lugar de 3 o más)
}, [grabbingHandIndex, initialGrabOffset]);

const lastInferenceTime = useRef(0);

const predictWebcam = useCallback(async () => {
  const now = performance.now();
  if (now - lastInferenceTime.current < 50) { // 20 FPS
    animationFrameId.current = requestAnimationFrame(predictWebcam);
    return;
  }
  lastInferenceTime.current = now;

  if (handLandmarkerRef.current && webcamRef.current && webcamRef.current.video && handLandmarkerLoaded) {
    const video = webcamRef.current.video;
    const results = handLandmarkerRef.current.detectForVideo(video, now);


    if (canvasRef.current) {
      drawLandmarks(results.landmarks, canvasRef.current, video);
    }

    detectPinchAndDrag(results);
  }

  animationFrameId.current = requestAnimationFrame(predictWebcam);
}, [handLandmarkerLoaded, drawLandmarks, detectPinchAndDrag]);
useEffect(() => {
  if (webcamRef.current && webcamRef.current.video && handLandmarkerLoaded) {
    const video = webcamRef.current.video;

    const checkIfVideoReady = () => {
      if (video.readyState === 4) {
        if (animationFrameId.current) {
          cancelAnimationFrame(animationFrameId.current);
        }
        predictWebcam(); // ✅ Asegúrate que esto se llama
      } else {
        setTimeout(checkIfVideoReady, 100);
      }
    };
    checkIfVideoReady();
  }

  return () => {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
    }
  };
}, [webcamRef, handLandmarkerLoaded, predictWebcam]);
  // --- UI del componente ---
  if (!handLandmarkerLoaded) {
    return <div className="flex items-center justify-center min-h-screen text-xl">Cargando modelo de detección de manos...</div>;
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col items-center justify-center bg-gray-100">
      <h1 className="text-3xl font-bold mb-4 z-10 text-center">Arrastrar con Gestos de Pinza (Touchless)</h1>
      <p className="mb-4 z-10 text-gray-700 text-center px-4">
        Asegúrate de que tu mano esté visible en la cámara. Haz un gesto de **pinza** (uniendo pulgar e índice) para agarrar una imagen y arrastrarla.
      </p>

      {/* Contenedor para la webcam y el canvas de dibujo de landmarks */}
      <div className="relative w-[640px] h-[480px] border-2 border-blue-500 rounded-lg overflow-hidden mb-4 bg-black">
        <Webcam
          ref={webcamRef}
          mirrored={true} // Espejo para que el usuario vea su mano como en un espejo
          className="absolute top-0 left-0 w-full h-full object-cover z-0"
          videoConstraints={{
            width: 640,
            height: 480,
            facingMode: "user" // Usa la cámara frontal
          }}
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full z-10"
          style={{ transform: 'scaleX(-1)' }} // Espejo el canvas para que el dibujo coincida con la imagen de la webcam espejada
        ></canvas>
      </div>

      {/* Contenedor de las imágenes arrastrables */}
      {/* Posicionamos este contenedor absolutamente sobre la webcam/canvas para que las imágenes se puedan "arrastrar" sobre la transmisión de video */}
      <div className="absolute w-[640px] h-[480px] top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        {images.map(img => (
          <img
  key={img.id}
  src={img.src}
  alt={img.id}
  className={`absolute cursor-grab ${img.grabbed ? 'border-4 border-green-500 shadow-lg' : ''}`}
 style={{
  transform: `translate3d(${img.x}px, ${img.y}px, 0)`,
  width: '80px',
  height: '80px',
  willChange: 'transform', // Mejora rendimiento
}}

/>

        ))}
      </div>

      <p className="mt-4 text-sm text-gray-500 z-10 px-4 text-center">
        Asegúrate de tener un entorno bien iluminado para una mejor detección.
      </p>
    </div>
  );
}