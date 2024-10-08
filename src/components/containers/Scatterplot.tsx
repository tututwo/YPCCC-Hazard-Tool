// @ts-nocheck
"use client";
import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
} from "react";
// NOTE: D3
import * as d3 from "d3";
import { Delaunay } from "d3-delaunay";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";

import { useMapStore } from "@/lib/store";
// NOTE: VISX
import { scaleLinear } from "@visx/scale";
import { Group } from "@visx/group";

import { withTooltip } from "@visx/tooltip";
import { WithTooltipProvidedProps } from "@visx/tooltip/lib/enhancers/withTooltip";

import { localPoint } from "@visx/event";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";

import Tooltip from "@/components/ui/tooltip";

// NOTE: R3F
import { Canvas } from "@react-three/fiber";

import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { Particles } from "./scatterplot-r3f/Scatterplot-R3f";
// import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useThrottledCallback } from "use-debounce";
// Add these constants for your color scales
import { twoSigFigFormatter, search } from "@/lib/utils";
const tickLabelProps = {
  fill: "#222",
  fontFamily: "Roboto",
  fontSize: 14,
  textAnchor: "middle",
  fillOpacity: 0.5,
};

const margin = { top: 20, right: 40, bottom: 60, left: 60 };

export const Scatterplot = withTooltip<DotsProps, PointsRange>(
  ({
    data,
    xVariable,
    yVariable,
    colorVariable,
    width,
    height,
    showControls = true,
    hideTooltip,
    showTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft,
    tooltipTop,
  }: DotsProps & WithTooltipProvidedProps<PointsRange>) => {
    const svgRef = useRef(null);
    const brushRef = useRef<any>(null);

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const xMax = width - margin.left - margin.right;
    const yMax = height - margin.bottom - margin.top;
    const [isBrushing, setIsBrushing] = useState(false);
    // FIXME: This is really slow. Improve it
    const [hoveredPoint, setHoveredPoint] = useState(null);
    const {
      selectedState,
      setSelectedState,
      colorScale,
      selectedCounties,
      updateSelectedCounties,
    } = useMapStore();

    // NOTE: Scales
    const x = useMemo(
      () =>
        scaleLinear<number>({
          domain: [0, 105],
          // range: [-200, 200],
          range: [0, xMax],
          clamp: true,
        }),
      [data, width]
    );
    const y = useMemo(
      () =>
        scaleLinear<number>({
          domain: [10, 75],
          // range: [-100, 100],
          range: [yMax, 0],
          clamp: true,
        }),
      [data, height]
    );

    // Use the colorScale in your coloredData calculation
    const coloredAndRaisedData = useMemo(() => {
      return data.map((d) => ({
        ...d,
        color: colorScale(d[colorVariable]),
      }));
    }, [data, colorScale, colorVariable]);

    // // // // // // // // // // // // // // // // // //
    // // // // // // // // Tooltip // // // // // // // //
    // // // // // // // // // // // // // // // // // //
    const delaunay = useMemo(() => {
      return Delaunay.from(
        coloredAndRaisedData,
        (d) => x(d[xVariable]),
        (d) => y(d[yVariable])
      );
    }, [coloredAndRaisedData, x, y, xVariable, yVariable]);

    const handleMouseMove = useCallback(
      (event) => {
        const point = localPoint(event);

        if (point) {
          const { x, y } = point;
          const index = delaunay.find(x - margin.left, y - margin.top);

          if (index !== undefined && index !== -1) {
            const datum = coloredAndRaisedData[index];
            setHoveredPoint(datum);

            // Optionally, show the tooltip
            showTooltip({
              tooltipLeft: x,
              tooltipTop: y,
              tooltipData: datum,
            });
          } else {
            setHoveredPoint(null);
            hideTooltip();
          }
        }
      },
      [delaunay, coloredAndRaisedData, showTooltip, hideTooltip, margin]
    );

    const handleMouseLeave = useCallback(() => {
      setHoveredPoint(null);
      hideTooltip();
    }, [hideTooltip]);

    const handleMouseDown = useCallback(() => {
      // setIsBrushing(true);
      hideTooltip();
    }, [hideTooltip]);

    const handleMouseUp = useCallback(() => {
      // setIsBrushing(false);
    }, []); // Add dependencies here

    // Initialize brush

    const quadtree = useMemo(() => {
      return d3
        .quadtree()
        .x((d) => x(d[xVariable]))
        .y((d) => y(d[yVariable]))
        .addAll(coloredAndRaisedData);
    }, [coloredAndRaisedData, xVariable, yVariable, width, height]);
    const brushing = useRef(false);
    const throttledUpdateSelectedCounties = useThrottledCallback(
      (newSelectedCounties: string[]) => {
        updateSelectedCounties(newSelectedCounties);
      },
      100 // Throttle updates to once every 100ms
    );
    const brushed = useCallback(
      (event: any) => {
        if (event.selection && quadtree) {
          const [[x0, y0], [x1, y1]] = event.selection;
          const selected: any[] = [];

          search(
            quadtree,
            [
              [x0, y0],
              [x1, y1],
            ],
            [],
            selected,
            x,
            y,
            xVariable,
            yVariable
          );

          const selectedSet = new Set(selected.map((d) => d.geoid));

          // Use the throttled function
          throttledUpdateSelectedCounties(Array.from(selectedSet));
        } else {
          // Cancel any pending updates and reset selection
          throttledUpdateSelectedCounties.cancel();
          updateSelectedCounties([]);
        }
      },
      [
        quadtree,
        x,
        y,
        xVariable,
        yVariable,
        throttledUpdateSelectedCounties,
        updateSelectedCounties,
      ]
    );

    const brushended = useCallback((event: any) => {
      brushing.current = false;
    }, []);
    const brush = useMemo(
      () =>
        d3
          .brush()
          .extent([
            [0, 0],
            [innerWidth, innerHeight],
          ])
          .on("start brush", brushed)
          .on("end", brushended),
      [width, height, brushed, brushended]
    );

    useEffect(() => {
      // Build quadtree for efficient searching

      if (svgRef.current) {
        const svg = d3.select(svgRef.current);
        svg.select("g#brush-layer").call(brush);

        svg
          .select(".selection")
          .attr("fill", "#A7BDD3")
          .attr("fill-opacity", 0.08)
          .attr("stroke", "#12375A")
          .attr("stroke-width", 1)
          .attr("stroke-opacity", 0.8);

        svg.selectAll(".handle").attr("fill", "#000").attr("fill-opacity", 0.2);

        svg
          .select(".overlay")
          .attr("pointer-events", "all")
          .attr("fill", "none");
        svg.selectAll(".handle").attr("fill", "none");
      }
    }, [width, height]);

    return (
      <>
        <Canvas
          dpr={Math.min(window.devicePixelRatio, 2)}
          gl={{ alpha: true, premultipliedAlpha: false }}
          onCreated={({ gl }) => {
            gl.setClearColor(0xffffff, 0); // Set the clear color to transparent
          }}
          style={{
            background: "transparent",
            position: "absolute",
            width: xMax,
            height: yMax,
            top: margin.top,
            left: margin.left,
            zIndex: 10,
          }}
        >
          {/* <color attach="background" args={["black"]} /> */}
          <OrthographicCamera
            makeDefault
            zoom={1}
            top={innerHeight}
            bottom={0}
            left={0}
            right={innerWidth}
            near={-1000}
            far={1000}
            position={[xMax / 2, yMax / 2, 500]}
          />
          <OrbitControls
            makeDefault
            target={[xMax / 2, yMax / 2, 0]}
            enableRotate={true}
            enableZoom={true}
            enablePan={true}
          />
          <Particles
            data={data}
            xScale={x}
            yScale={y}
            xVariable={xVariable}
            yVariable={yVariable}
            colorVariable={colorVariable}
            margin={margin}
          />
          {/* <axesHelper args={[1000]} /> */}
          {/* <EffectComposer>
            <Bloom
              luminanceThreshold={0.1}
              intensity={0.1}
              levels={9}
              mipmapBlur
            />
          </EffectComposer> */}
        </Canvas>
        <svg
          width={width}
          className="absolute  h-full"
          style={{
            maxHeight: height,
          }}
        >
          <Group left={margin.left} top={margin.top}>
            <GridRows
              scale={y}
              width={xMax}
              height={yMax}
              stroke="#F2F2F2"
              strokeWidth={1.5}
              className="z-0"
            />
            <GridColumns
              scale={x}
              width={xMax}
              height={yMax}
              stroke="#F2F2F2"
              strokeWidth={1.5}
              className="z-0"
            />

            <AxisBottom
              top={yMax}
              scale={x}
              numTicks={width > 520 ? 10 : 5}
              hideTicks
              hideZero
              hideAxisLine
              label="Rating"
              labelClassName="text-base font-bold text-gray-500 "
              tickLabelProps={tickLabelProps}
            />
            <AxisLeft
              scale={y}
              hideTicks
              numTicks={5}
              hideZero
              hideAxisLine
              label="Worry"
              labelClassName="text-base font-bold text-gray-500"
              tickLabelProps={tickLabelProps}
            />
          </Group>
        </svg>
        <svg
          ref={svgRef}
          width={width}
          className="absolute  h-full z-50"
          style={{
            maxHeight: height,
            cursor: isBrushing ? "crosshair" : "pointer",
          }}
        >
          <Group
            id="brush-layer"
            left={margin.left}
            top={margin.top}
            onPointerMove={handleMouseMove}
            onPointerLeave={handleMouseLeave}
          >
            {hoveredPoint && (
              <circle
                cx={x(hoveredPoint[xVariable])}
                cy={y(hoveredPoint[yVariable])}
                r={6}
                fill="white"
                stroke={colorScale(hoveredPoint[colorVariable])}
                strokeWidth={2}
              />
            )}
          </Group>
        </svg>
        {/* FIXME: This is expensive calculation */}
        {tooltipOpen &&
          tooltipData &&
          tooltipLeft != null &&
          tooltipTop != null && (
            <Tooltip
              left={tooltipLeft}
              top={tooltipTop + margin.top}
              county={tooltipData.County_name}
              state={tooltipData.state}
              gap={twoSigFigFormatter(tooltipData[colorVariable])}
              worry={twoSigFigFormatter(tooltipData[yVariable])}
              rating={twoSigFigFormatter(tooltipData[xVariable])}
            />
          )}
      </>
    );
  }
);
