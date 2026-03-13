import express from "express";
import userRoutes from "./user.route.js";
import clientRoute from "./client.routes.js";
import venueRoutes from "./venue.routes.js";
import supplierRoutes from "./supplier.routes.js";
import equipmentRoutes from "./equipment.routes.js";
import packageRoutes from "./package.routes.js";
import companyRoutes from "./company.routes.js";
import rolePermissionRoutes from "./rolePermission.routes.js";
import emailContentRoutes from "./emailContent.routes.js";
import enquiryRoutes from "./enquiry.routes.js";
import confirmEventsRoutes from "./confirmEvents.routes.js";
import todoRoutes from "./todo.routes.js";
import fileUploadRoutes from "./fileUpload.routes.js";
import calendarRoutes from "./calendar.routes.js";
import rigListRoutes from "./rigList.routes.js";
import reportRoutes from "./reports.routes.js";

const router = express.Router();

const defaultRoutes = [
  {
    path: "/user",
    route: userRoutes,
  },
  {
    path: "/client",
    route: clientRoute,
  },
  {
    path: "/venue",
    route: venueRoutes,
  },
  {
    path: "/supplier",
    route: supplierRoutes,
  },
  {
    path: "/equipment",
    route: equipmentRoutes,
  },
  {
    path: "/package",
    route: packageRoutes,
  },
  {
    path: "/company",
    route: companyRoutes,
  },
  {
    path: "/roles-permissions",
    route: rolePermissionRoutes,
  },
  {
    path: "/email-content",
    route: emailContentRoutes,
  },
  {
    path: "/enquiry",
    route: enquiryRoutes,
  },
  {
    path: "/confirm-event",
    route: confirmEventsRoutes,
  },
  {
    path: "/todos",
    route: todoRoutes,
  },
  {
    path: "/files",
    route: fileUploadRoutes,
  },
  {
    path: "/calendar",
    route: calendarRoutes,
  },
  {
    path: "/rig-list",
    route: rigListRoutes,
  },
  {
    path: "/reports",
    route: reportRoutes,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;
