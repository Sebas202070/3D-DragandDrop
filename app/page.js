
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
    if (!video || !results || !results.landmarks || results.landmarks.length === 0) {
      // Si no hay manos detectadas o los resultados son nulos, soltar cualquier imagen agarrada
      setImages(prevImages => prevImages.map(img => ({ ...img, grabbed: false })));
      setGrabbingHandIndex(null); // Reiniciar la mano que agarra
      return;
    }

    const currentGrabbingHand = grabbingHandIndex; // Índice de la mano que actualmente está agarrando
    let newGrabbingHandIndex = null; // Índice de la mano que se detecta haciendo pinza en este frame
    let newHandPosition = null; // Posición de la pinza (punta del índice)

    // Iterar sobre cada mano detectada por MediaPipe
    results.landmarks.forEach((handLandmarks, handIndex) => {
      // Puntos clave para la pinza: punta del pulgar (4) y punta del índice (8)
      const thumbTip = handLandmarks[4];
      const indexTip = handLandmarks[8];

      // Calcular la distancia euclidiana 3D entre el pulgar y el índice
      // (considerando x, y, z para mayor precisión del gesto de pinza)
      const distance = Math.sqrt(
        Math.pow(thumbTip.x - indexTip.x, 2) +
        Math.pow(thumbTip.y - indexTip.y, 2) +
        Math.pow(thumbTip.z - indexTip.z, 2)
      );

      // Convertir las coordenadas normalizadas (0-1) a píxeles de la resolución del video
     const handX = (1 - indexTip.x) * video.videoWidth; // 👈 Invertimos el eje X

      const handY = indexTip.y * video.videoHeight;

      if (distance < PINCH_THRESHOLD) { // Si la distancia es menor al umbral, ¡se detectó una pinza!
        console.log(`Pinza detectada en mano ${handIndex}. Distancia: ${distance.toFixed(3)}`);
        newGrabbingHandIndex = handIndex; // Registrar esta mano como la que hace la pinza
        newHandPosition = { x: handX, y: handY }; // Registrar su posición
      }
    });

    // Actualizar el estado de las imágenes (grabbed o no grabbed, y posición)
    setImages(prevImages => {
      // Crear una copia profunda del array de imágenes para evitar mutaciones directas en el estado
      const updatedImages = prevImages.map(img => ({ ...img }));

      // --- Lógica para INICIAR el AGARRE ---
      if (newGrabbingHandIndex !== null && currentGrabbingHand === null) {
        // Se detectó una nueva pinza Y ninguna imagen estaba siendo agarrada previamente
        const grabbedImageIndex = updatedImages.findIndex(img =>
          newHandPosition.x > img.x &&
newHandPosition.x < img.x + 80 &&
newHandPosition.y > img.y &&
newHandPosition.y < img.y + 80
  // 150 es el alto de las imágenes placeholder
        );

        if (grabbedImageIndex !== -1) { // Si la pinza está sobre una imagen
          updatedImages[grabbedImageIndex].grabbed = true; // Marcar esa imagen como agarrada
          setGrabbingHandIndex(newGrabbingHandIndex); // Registrar qué mano la agarró
          // Calcular el offset inicial: la diferencia entre la posición de la pinza y la esquina superior izquierda de la imagen
          setInitialGrabOffset({
            x: newHandPosition.x - updatedImages[grabbedImageIndex].x,
            y: newHandPosition.y - updatedImages[grabbedImageIndex].y,
          });
          console.log(`Imagen ${updatedImages[grabbedImageIndex].id} agarrada por mano ${newGrabbingHandIndex}`);
        }
      }
      // --- Lógica para ARRASTRAR (mover) la imagen ---
      else if (newGrabbingHandIndex !== null && currentGrabbingHand === newGrabbingHandIndex) {
        // La misma mano que inició el agarre sigue haciendo pinza, mover la imagen
        const grabbedImageIndex = updatedImages.findIndex(img => img.grabbed);
        if (grabbedImageIndex !== -1) {
          // Mover la imagen basándose en la nueva posición de la pinza y el offset inicial
          updatedImages[grabbedImageIndex].x = newHandPosition.x - initialGrabOffset.x;
          updatedImages[grabbedImageIndex].y = newHandPosition.y - initialGrabOffset.y;
        }
      }
      // --- Lógica para SOLTAR la imagen ---
      else if (newGrabbingHandIndex === null && currentGrabbingHand !== null) {
        // No se detecta pinza, pero una imagen estaba siendo agarrada, entonces se suelta
        const grabbedImageIndex = updatedImages.findIndex(img => img.grabbed);
        if (grabbedImageIndex !== -1) {
          updatedImages[grabbedImageIndex].grabbed = false; // Marcar imagen como no agarrada
          console.log(`Imagen ${updatedImages[grabbedImageIndex].id} soltada.`);
        }
        setGrabbingHandIndex(null); // Reiniciar la mano que agarraba
        setInitialGrabOffset({ x: 0, y: 0 }); // Reiniciar el offset
      }

      return updatedImages; // Devolver el estado actualizado de las imágenes
    });

  }, [grabbingHandIndex, initialGrabOffset]); // Dependencias del useCallback

  // --- 4. Bucle principal de detección de video (requestAnimationFrame) ---
  const predictWebcam = useCallback(async () => {
    // Solo ejecutar si el modelo está cargado, la webcam está lista y la video está disponible
    if (handLandmarkerRef.current && webcamRef.current && webcamRef.current.video && handLandmarkerLoaded) {
      const video = webcamRef.current.video;
      // Detectar landmarks de mano en el frame actual del video
      const results = handLandmarkerRef.current.detectForVideo(video, performance.now());

      // Dibujar los landmarks si el canvas está disponible
      if (canvasRef.current) {
        drawLandmarks(results.landmarks, canvasRef.current, video);
      }

      // Ejecutar la lógica de detección de pinza y arrastre
      detectPinchAndDrag(results);
    }
    // Continuar el bucle en el próximo frame
    animationFrameId.current = requestAnimationFrame(predictWebcam);
  }, [handLandmarkerLoaded, drawLandmarks, detectPinchAndDrag]);

  // Iniciar y limpiar el bucle de detección de video
  useEffect(() => {
    if (webcamRef.current && webcamRef.current.video && handLandmarkerLoaded) {
      const video = webcamRef.current.video;
      // Esperar a que el video esté completamente cargado y listo para ser reproducido
      const checkIfVideoReady = () => {
        if (video.readyState === 4) { // readyState 4 significa 'HAVE_ENOUGH_DATA'
          if (animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current); // Limpiar cualquier bucle anterior
          }
          predictWebcam(); // Iniciar el bucle de predicción
        } else {
          setTimeout(checkIfVideoReady, 100); // Reintentar en 100ms si no está listo
        }
      };
      checkIfVideoReady();
    }
    // Función de limpieza para cancelar el requestAnimationFrame cuando el componente se desmonte
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
    left: img.x,
    top: img.y,
    width: '80px',     // Tamaño reducido
    height: '80px',    // Tamaño reducido
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