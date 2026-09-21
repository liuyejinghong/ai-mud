-- v0.15 能源与尘暴：天气日程（确定性循环）+ 积尘等级。
ALTER TABLE "base_power_state" ADD "dust_level" integer DEFAULT 30 NOT NULL;
--> statement-breakpoint
CREATE TABLE "base_weather_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"weather" text NOT NULL,
	"start_sim" timestamp with time zone NOT NULL,
	"end_sim" timestamp with time zone NOT NULL,
	CONSTRAINT "base_weather_schedule_base_start_idx" UNIQUE("base_id","start_sim"),
	CONSTRAINT "base_weather_schedule_weather_check" CHECK ("base_weather_schedule"."weather" IN ('clear', 'warning', 'storm'))
);
--> statement-breakpoint
CREATE INDEX "base_weather_schedule_base_seq_idx" ON "base_weather_schedule" ("base_id","seq");
--> statement-breakpoint
ALTER TABLE "base_weather_schedule" ADD CONSTRAINT "base_weather_schedule_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
