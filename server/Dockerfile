FROM golang:1.26.5 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/server ./cmd/server && CGO_ENABLED=0 go build -trimpath -o /out/migrate ./cmd/migrate
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/server /out/migrate ./
COPY db/migrations ./db/migrations
ENV HTTP_ADDR=0.0.0.0:8000 GRPC_ADDR=0.0.0.0:9000
EXPOSE 8000 9000
ENTRYPOINT ["/app/server"]
